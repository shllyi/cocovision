import tensorflow as tf
from tensorflow.keras.preprocessing.image import ImageDataGenerator
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras import layers, models
import os
import matplotlib
matplotlib.use('Agg')  # non-interactive: saves files without popup windows
import matplotlib.pyplot as plt
import numpy as np
from sklearn.metrics import classification_report, confusion_matrix, precision_recall_curve, average_precision_score
from sklearn.preprocessing import label_binarize
from sklearn.utils.class_weight import compute_class_weight
import seaborn as sns



BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TRAIN_DIR = os.path.join(BASE_DIR, 'own_dataset', 'train')
VALID_DIR = os.path.join(BASE_DIR, 'own_dataset', 'valid')

# 2. PREPARE DATA (Data Augmentation)
# This helps the AI learn even if you have few images
train_datagen = ImageDataGenerator(
    rescale=1./255,
    rotation_range=30,
    width_shift_range=0.2,
    height_shift_range=0.2,
    shear_range=0.2,
    zoom_range=0.2,
    horizontal_flip=True,
    fill_mode='nearest'
)

valid_datagen = ImageDataGenerator(rescale=1./255)

train_generator = train_datagen.flow_from_directory(
    TRAIN_DIR,
    target_size=(224, 224),
    batch_size=32,          
    class_mode='categorical'
)

valid_generator = valid_datagen.flow_from_directory(
    VALID_DIR,
    target_size=(224, 224),
    batch_size=32,
    class_mode='categorical',
    shuffle=False  # MUST be False so prediction order matches valid_generator.classes
)

# 3. BUILD THE MODEL
print("Building model...")
num_classes = len(train_generator.class_indices)
print(f"Detected classes: {list(train_generator.class_indices.keys())}")
print(f"Number of classes: {num_classes}")

base_model = MobileNetV2(weights='imagenet', include_top=False, input_shape=(224, 224, 3))
base_model.trainable = False  # Freeze for phase 1

model = models.Sequential([
    base_model,
    layers.GlobalAveragePooling2D(),
    layers.Dense(256, activation='relu'),
    layers.Dropout(0.4),
    layers.Dense(128, activation='relu'),
    layers.Dropout(0.3),
    layers.Dense(num_classes, activation='softmax')
])

# ── Custom callback: records per-class AP and mAP after every epoch ──────────
class mAPEvalCallback(tf.keras.callbacks.Callback):
    """Computes macro mAP on the validation set at the end of each epoch."""
    def __init__(self, validation_generator, num_classes, class_names):
        super().__init__()
        self.validation_generator = validation_generator
        self.num_classes = num_classes
        self.class_names = class_names
        self.per_class_ap = [[] for _ in range(num_classes)]
        self.mean_ap = []

    def on_epoch_end(self, epoch, logs=None):
        self.validation_generator.reset()
        y_scores_list, y_true_list = [], []
        for _ in range(len(self.validation_generator)):
            x_batch, y_batch = next(self.validation_generator)
            preds = self.model.predict(x_batch, verbose=0)
            y_scores_list.extend(preds)
            y_true_list.extend(np.argmax(y_batch, axis=1))

        y_sc = np.array(y_scores_list)
        y_tr = np.array(y_true_list)
        y_tr_bin = label_binarize(y_tr, classes=list(range(self.num_classes)))
        if self.num_classes == 2:
            y_tr_bin = np.hstack([1 - y_tr_bin, y_tr_bin])

        for i in range(self.num_classes):
            ap = average_precision_score(y_tr_bin[:, i], y_sc[:, i])
            self.per_class_ap[i].append(ap)

        map_score = average_precision_score(y_tr_bin, y_sc, average='macro')
        self.mean_ap.append(map_score)
        if logs is not None:
            logs['val_mAP'] = map_score
        print(f" - val_mAP: {map_score:.4f}", end="")


# Compute class weights to handle imbalance
class_weights = compute_class_weight(
    class_weight='balanced',
    classes=np.unique(train_generator.classes),
    y=train_generator.classes
)
class_weight_dict = dict(enumerate(class_weights))
print(f"Class weights: {class_weight_dict}")

# Instantiate mAP callback once — accumulates across both phases
map_callback = mAPEvalCallback(valid_generator, num_classes,
                               list(train_generator.class_indices.keys()))

# 4. PHASE 1: Train only the top layers (frozen backbone)
print("Phase 1: Training top layers with frozen backbone...")

phase1_epochs = 20

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-3),
    loss='categorical_crossentropy',
    metrics=[
        'accuracy',
        tf.keras.metrics.Precision(name='precision'),
        tf.keras.metrics.Recall(name='recall')
    ]
)

early_stop = tf.keras.callbacks.EarlyStopping(
    monitor='val_accuracy', patience=8, restore_best_weights=True
)
lr_scheduler = tf.keras.callbacks.ReduceLROnPlateau(
    monitor='val_loss', factor=0.5, patience=3, min_lr=1e-6, verbose=1
)

history1 = model.fit(
    train_generator,
    validation_data=valid_generator,
    epochs=phase1_epochs,
    class_weight=class_weight_dict,
    callbacks=[early_stop, lr_scheduler, map_callback]
)

# 4b. PHASE 2: Unfreeze last 50 layers of backbone for fine-tuning
print("Phase 2: Fine-tuning unfrozen backbone layers...")
base_model.trainable = True
for layer in base_model.layers[:-50]:
    layer.trainable = False

model.compile(
    optimizer=tf.keras.optimizers.Adam(learning_rate=1e-4),  # Lower LR for fine-tuning
    loss='categorical_crossentropy',
    metrics=[
        'accuracy',
        tf.keras.metrics.Precision(name='precision'),
        tf.keras.metrics.Recall(name='recall')
    ]
)

phase2_epochs = 30
history2 = model.fit(
    train_generator,
    validation_data=valid_generator,
    epochs=phase2_epochs,
    class_weight=class_weight_dict,
    callbacks=[early_stop, lr_scheduler, map_callback]
)

# Merge both phase histories for plotting
history_combined = {}
for key in history1.history:
    history_combined[key] = history1.history[key] + history2.history[key]
# Use actual epoch count (EarlyStopping may have stopped before max epochs)
epochs = len(history_combined['loss'])

class history:
    pass
history.history = history_combined

# 5. SAVE THE BRAIN
model_save_path = os.path.join(BASE_DIR, '..', 'models', 'coconut_model_4class3resuslts.h5')
model.save(model_save_path)
print(f"Success! Model saved to: {model_save_path}")

# 6. PLOT TRAINING ANALYTICS (like YOLO results)
class_names = list(train_generator.class_indices.keys())
results_dir = os.path.join(BASE_DIR, '..', 'models', 'results_own_dataset')
os.makedirs(results_dir, exist_ok=True)

epochs_range = range(1, epochs + 1)

# --- results.png: top row = train metrics, bottom row = val metrics ---
fig, axes = plt.subplots(2, 4, figsize=(20, 8))
fig.suptitle(f'Training Results - own_dataset ({num_classes} classes: {", ".join(class_names)})', fontsize=14)

row_metrics = [
    [('loss', 'train/loss'), ('accuracy', 'train/accuracy'), ('precision', 'train/precision'), ('recall', 'train/recall')],
    [('val_loss', 'val/loss'), ('val_accuracy', 'val/accuracy'), ('val_precision', 'val/precision'), ('val_recall', 'val/recall')],
]
for row, row_data in enumerate(row_metrics):
    for col, (key, label) in enumerate(row_data):
        ax = axes[row][col]
        values = history.history[key]
        ax.plot(epochs_range, values, 'g-', label='results')
        smooth = np.convolve(values, np.ones(3)/3, mode='same')
        ax.plot(epochs_range, smooth, 'r:', label='smooth')
        ax.set_title(label)
        ax.set_xlabel('Epoch')
        ax.legend(fontsize=7)
        ax.grid(True, alpha=0.3)

plt.tight_layout()
plot_path = os.path.join(results_dir, 'results.png')
plt.savefig(plot_path, dpi=150)
plt.close()
print(f"Results saved to: {plot_path}")

# --- Predictions on validation set ---
print("Running predictions safely...")
y_scores_list = []
y_true_list = []

valid_generator.reset()
for i in range(len(valid_generator)):
    x_batch, y_batch = next(valid_generator)
    preds = model.predict(x_batch, verbose=0)
    y_scores_list.extend(preds)
    y_true_list.extend(np.argmax(y_batch, axis=1))

y_scores = np.array(y_scores_list)
y_true = np.array(y_true_list)
y_pred = np.argmax(y_scores, axis=1)

# --- confusion_matrix.png ---
cm = confusion_matrix(y_true, y_pred)
cm_norm = cm.astype('float') / cm.sum(axis=1)[:, np.newaxis]
cm_display = cm_norm.T  # rows=Predicted, cols=True
fig_cm, ax_cm = plt.subplots(figsize=(8, 6))
sns.heatmap(cm_display, annot=True, fmt='.2f', cmap='Greens', ax=ax_cm,
            xticklabels=class_names, yticklabels=class_names, vmin=0, vmax=1)
ax_cm.set_title('Confusion Matrix Normalized')
ax_cm.set_ylabel('Predicted')
ax_cm.set_xlabel('True')
fig_cm.tight_layout()
cm_path = os.path.join(results_dir, 'confusion_matrix.png')
fig_cm.savefig(cm_path, dpi=150)
plt.close()
print(f"Confusion matrix saved to: {cm_path}")

# Classification report
print("\n--- Classification Report (own_dataset) ---")
print(classification_report(y_true, y_pred, target_names=class_names))

# 7. PR_curve.png
y_true_bin = label_binarize(y_true, classes=list(range(num_classes)))
fig_pr, ax_pr = plt.subplots(figsize=(8, 6))
colors = ['#006400', '#228B22', '#32CD32', '#90EE90']
for i, cls in enumerate(class_names):
    precision_vals, recall_vals, _ = precision_recall_curve(y_true_bin[:, i], y_scores[:, i])
    ap = average_precision_score(y_true_bin[:, i], y_scores[:, i])
    ax_pr.plot(recall_vals, precision_vals, color=colors[i % len(colors)], label=f'{cls} {ap:.3f}')
mAP = average_precision_score(y_true_bin, y_scores, average='macro')
ax_pr.plot([], [], ' ', label=f'all classes {mAP:.3f} mAP@0.5')
ax_pr.set_xlabel('Recall')
ax_pr.set_ylabel('Precision')
ax_pr.set_title('Precision-Recall Curve')
ax_pr.legend(loc='upper right')
ax_pr.grid(True, alpha=0.3)
ax_pr.set_xlim([0, 1])
ax_pr.set_ylim([0, 1.05])
fig_pr.tight_layout()
pr_path = os.path.join(results_dir, 'PR_curve.png')
fig_pr.savefig(pr_path, dpi=150)
plt.close()
print(f"PR curve saved to: {pr_path}")

# 8. model_testing.png — bar chart: Precision, Recall, Average Precision (AP)
from sklearn.metrics import precision_score, recall_score
macro_precision = precision_score(y_true, y_pred, average='macro', zero_division=0)
macro_recall    = recall_score(y_true, y_pred, average='macro', zero_division=0)

y_true_bin = label_binarize(y_true, classes=list(range(num_classes)))
average_precision = average_precision_score(y_true_bin, y_scores, average='macro')

bar_labels  = ['Precision', 'Recall', 'Average Precision (AP)']
bar_values  = [macro_precision, macro_recall, average_precision]
bar_colors  = ['#4CAF50', '#66BB6A', '#A5D6A7']

fig_mt, ax_mt = plt.subplots(figsize=(8, 6))
bars = ax_mt.bar(bar_labels, bar_values, color=bar_colors, width=0.5)
ax_mt.set_ylim(0, max(bar_values) * 1.2 if max(bar_values) > 0 else 1.0)
ax_mt.set_title('Model Testing')
ax_mt.set_ylabel('Score')
ax_mt.grid(axis='y', alpha=0.3)
for bar, val in zip(bars, bar_values):
    ax_mt.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
               f'{val:.3f}', ha='center', va='bottom', fontsize=10)
fig_mt.tight_layout()
mt_path = os.path.join(results_dir, 'model_testing.png')
fig_mt.savefig(mt_path, dpi=150)
plt.close()
print(f"Model testing chart saved to: {mt_path}")

# 9. mAP_eval.png — mAP vs Epoch (per-class AP + overall mAP)
total_epochs = len(map_callback.mean_ap)
map_epochs   = range(1, total_epochs + 1)

markers    = ['o', '^', 's', 'D', 'v', 'p']
map_colors = ['#d62728', '#2ca02c', '#ff7f0e', '#9467bd', '#8c564b', '#e377c2']

fig_map, ax_map = plt.subplots(figsize=(8, 6))
for i, cls in enumerate(class_names):
    ax_map.plot(map_epochs, map_callback.per_class_ap[i],
                marker=markers[i % len(markers)],
                color=map_colors[i % len(map_colors)],
                linewidth=1.5, markersize=5,
                label=cls)
ax_map.plot(map_epochs, map_callback.mean_ap,
            marker=markers[num_classes % len(markers)],
            color='blue', linewidth=2, markersize=6,
            label=f'mAP  (final={map_callback.mean_ap[-1]:.3f})')
ax_map.set_xlabel('epoch')
ax_map.set_ylabel('mAP')
ax_map.set_title('mAP Eval')
ax_map.legend(loc='lower right', fontsize=9)
ax_map.grid(True, alpha=0.3)
ax_map.set_xlim([1, total_epochs])
ax_map.set_ylim([0, 1.05])
fig_map.tight_layout()
map_eval_path = os.path.join(results_dir, 'mAP_eval.png')
fig_map.savefig(map_eval_path, dpi=150)
plt.close()
print(f"mAP eval chart saved to: {map_eval_path}")
