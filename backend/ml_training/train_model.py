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
import seaborn as sns

# 1. SET YOUR PATHS
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
TRAIN_DIR = os.path.join(BASE_DIR, 'new', 'train')
VALID_DIR = os.path.join(BASE_DIR, 'new', 'valid')

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
base_model.trainable = False  # Freeze the pre-trained layers

model = models.Sequential([
    base_model,
    layers.GlobalAveragePooling2D(),
    layers.Dense(128, activation='relu'),
    layers.Dropout(0.3),
    layers.Dense(num_classes, activation='softmax')
])

model.compile(
    optimizer='adam',
    loss='categorical_crossentropy',
    metrics=[
        'accuracy',
        tf.keras.metrics.Precision(name='precision'),
        tf.keras.metrics.Recall(name='recall')
    ]
)

# 4. START TRAINING
print("Starting training...")
epochs = 30
history = model.fit(
    train_generator,
    validation_data=valid_generator,
    epochs=epochs
)

# 5. SAVE THE BRAIN
model_save_path = os.path.join(BASE_DIR, '..', 'models', 'coconut_modelresults.h5')
model.save(model_save_path)
print(f"Success! Model saved to: {model_save_path}")

# 6. PLOT TRAINING ANALYTICS (like YOLO results)
class_names = list(train_generator.class_indices.keys())
results_dir = os.path.join(BASE_DIR, '..', 'models', 'results_new')
os.makedirs(results_dir, exist_ok=True)

epochs_range = range(1, epochs + 1)

# --- results.png: top row = train metrics, bottom row = val metrics ---
fig, axes = plt.subplots(2, 4, figsize=(20, 8))
fig.suptitle(f'Training Results - new ({num_classes} classes: {", ".join(class_names)})', fontsize=14)

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
print("\n--- Classification Report (new dataset) ---")
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