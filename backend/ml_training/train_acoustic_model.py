"""
Acoustic Model Trainer
======================
Trains a coconut maturity classifier (malakanin / malauhog) from the
pre-processed & augmented acoustic dataset.

Dataset layout expected:
  acoustic_new/train/{class}/*.wav
  acoustic_new/valid/{class}/*.wav
  acoustic_new/test/{class}/*.wav

Output:
  models/coconut_acoustic_model3.pkl
    → dict: {
        'classifier'   : sklearn Pipeline (scaler + SVM),
        'label_encoder': sklearn LabelEncoder,
        'feature_config': dict with extraction params,
      }

Feature vector per file (~238 dims):
  - 40 MFCCs      → mean + std  (80)
  - 12 Chroma     → mean + std  (24)
  - 128 Mel-bands → mean + std  (256)  ← dominant info
  - Spectral centroid, bandwidth, rolloff, ZCR, RMS  → mean + std  (10)
  ──────────────────────────────────────────────────
  Total: 370 features

Requirements:
  pip install librosa soundfile scikit-learn numpy scipy
"""

import os
import pickle
import random
import warnings
from pathlib import Path

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
import librosa
import soundfile as sf
import seaborn as sns

from sklearn.preprocessing import LabelEncoder, StandardScaler, label_binarize
from sklearn.svm import SVC
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    classification_report, confusion_matrix, accuracy_score, balanced_accuracy_score,
    precision_recall_curve, average_precision_score, precision_score, recall_score,
    log_loss
)
from sklearn.model_selection import (
    cross_val_score, StratifiedKFold, GridSearchCV
)

warnings.filterwarnings("ignore")

# ─────────────────────────────────────────────────────────────────
# Paths
# ─────────────────────────────────────────────────────────────────
BASE_DIR    = Path(__file__).parent
DATASET_DIR = BASE_DIR / "acoustic_new"
MODEL_DIR   = BASE_DIR.parent / "models"
MODEL_PATH  = MODEL_DIR / "coconut_acoustic_modelresults2.pkl"
RESULTS_DIR = MODEL_DIR / "results_acoustic"

CLASSES     = ["malakanin", "malauhog"]

SEED = 42
random.seed(SEED)
np.random.seed(SEED)

# ─────────────────────────────────────────────────────────────────
# Feature extraction  (MUST stay in sync with services/acoustic.py)
# ─────────────────────────────────────────────────────────────────
FEATURE_CONFIG = {
    "sample_rate"  : 22050,
    "n_mfcc"       : 40,
    "n_chroma"     : 12,
    "n_mels"       : 128,
    "hop_length"   : 512,
    "n_fft"        : 2048,
}


def extract_features(y: np.ndarray, sr: int, cfg: dict = FEATURE_CONFIG) -> np.ndarray:
    """
    Extract a fixed-length feature vector from an audio clip.
    Returns a 1-D numpy array of float32.
    """
    n_fft      = cfg["n_fft"]
    hop_length = cfg["hop_length"]
    n_mfcc     = cfg["n_mfcc"]
    n_chroma   = cfg["n_chroma"]
    n_mels     = cfg["n_mels"]

    feats = []

    # 1. MFCCs (mean + std → 2 × n_mfcc)
    mfcc = librosa.feature.mfcc(y=y, sr=sr, n_mfcc=n_mfcc,
                                  n_fft=n_fft, hop_length=hop_length)
    feats.extend(np.mean(mfcc, axis=1))
    feats.extend(np.std(mfcc, axis=1))

    # 2. Chroma (mean + std → 2 × n_chroma)
    chroma = librosa.feature.chroma_stft(y=y, sr=sr, n_chroma=n_chroma,
                                          n_fft=n_fft, hop_length=hop_length)
    feats.extend(np.mean(chroma, axis=1))
    feats.extend(np.std(chroma, axis=1))

    # 3. Mel-spectrogram (mean + std → 2 × n_mels)
    mel = librosa.feature.melspectrogram(y=y, sr=sr, n_mels=n_mels,
                                          n_fft=n_fft, hop_length=hop_length)
    mel_db = librosa.power_to_db(mel, ref=np.max)
    feats.extend(np.mean(mel_db, axis=1))
    feats.extend(np.std(mel_db, axis=1))

    # 4. Spectral centroid  (mean + std → 2)
    sc = librosa.feature.spectral_centroid(y=y, sr=sr,
                                            n_fft=n_fft, hop_length=hop_length)
    feats.append(float(np.mean(sc)))
    feats.append(float(np.std(sc)))

    # 5. Spectral bandwidth  (mean + std → 2)
    sb = librosa.feature.spectral_bandwidth(y=y, sr=sr,
                                             n_fft=n_fft, hop_length=hop_length)
    feats.append(float(np.mean(sb)))
    feats.append(float(np.std(sb)))

    # 6. Spectral roll-off  (mean + std → 2)
    sro = librosa.feature.spectral_rolloff(y=y, sr=sr,
                                            n_fft=n_fft, hop_length=hop_length)
    feats.append(float(np.mean(sro)))
    feats.append(float(np.std(sro)))

    # 7. Zero-crossing rate  (mean + std → 2)
    zcr = librosa.feature.zero_crossing_rate(y, hop_length=hop_length)
    feats.append(float(np.mean(zcr)))
    feats.append(float(np.std(zcr)))

    # 8. RMS energy  (mean + std → 2)
    rms = librosa.feature.rms(y=y, hop_length=hop_length)
    feats.append(float(np.mean(rms)))
    feats.append(float(np.std(rms)))

    return np.array(feats, dtype=np.float32)


def preprocess_audio(y: np.ndarray, sr: int, duration: float = 5.0, top_db: int = 30) -> np.ndarray:
    """
    Apply IDENTICAL preprocessing as services/acoustic.py :: preprocess_for_own_dataset().
    MUST stay in sync with that function.
      1. Trim leading/trailing silence
      2. Normalize amplitude to [-1, 1]
      3. Crop from centre (or pad) to exactly `duration` seconds
    """
    # 1. Trim silence
    y_trimmed, _ = librosa.effects.trim(y, top_db=top_db)

    # If trimming removed everything (pure silence), fall back to original
    if len(y_trimmed) < 100:
        y_trimmed = y

    # 2. Normalize amplitude to [-1, 1]
    max_val = np.max(np.abs(y_trimmed))
    if max_val > 0:
        y_trimmed = y_trimmed / max_val

    # 3. Crop from centre or pad to exactly `duration` seconds
    target_len = int(sr * duration)
    if len(y_trimmed) >= target_len:
        start = (len(y_trimmed) - target_len) // 2
        y_out = y_trimmed[start: start + target_len]
    else:
        pad_len = target_len - len(y_trimmed)
        y_out = np.pad(y_trimmed, (0, pad_len), mode="reflect")

    return y_out.astype(np.float32)


# ─────────────────────────────────────────────────────────────────
# Data loading
# ─────────────────────────────────────────────────────────────────

def load_split(split: str) -> tuple[np.ndarray, list[str]]:
    """Load all WAV files from acoustic/{split}/{class}/ and extract features."""
    X, y_labels = [], []
    split_dir = DATASET_DIR / split

    for cls in CLASSES:
        cls_dir = split_dir / cls
        if not cls_dir.exists():
            print(f"  ⚠  {cls_dir} not found – skipping")
            continue

        wav_files = sorted(cls_dir.glob("*.wav")) + sorted(cls_dir.glob("*.WAV"))
        print(f"  [{split:5s}] {cls:12s} → {len(wav_files)} files", end="", flush=True)

        ok, fail = 0, 0
        for fp in wav_files:
            try:
                wav, sr = sf.read(str(fp))
                wav = wav.astype(np.float32)
                if wav.ndim > 1:
                    wav = wav.mean(axis=1)
                # Resample if necessary
                if sr != FEATURE_CONFIG["sample_rate"]:
                    wav = librosa.resample(wav, orig_sr=sr,
                                           target_sr=FEATURE_CONFIG["sample_rate"])
                    sr = FEATURE_CONFIG["sample_rate"]
                # Apply SAME preprocessing as inference pipeline
                wav = preprocess_audio(wav, sr)
                feat = extract_features(wav, sr)
                X.append(feat)
                y_labels.append(cls)
                ok += 1
            except Exception as e:
                fail += 1
                print(f"\n    ✗ {fp.name}: {e}")

        print(f"  (ok={ok}, failed={fail})")

    if not X:
        return np.empty((0,)), []

    return np.vstack(X), y_labels


# ─────────────────────────────────────────────────────────────────
# Training
# ─────────────────────────────────────────────────────────────────

def train():
    print("\n" + "=" * 60)
    print("  Acoustic Model Trainer")
    print("=" * 60)
    print(f"  Dataset : {DATASET_DIR}")
    print(f"  Output  : {MODEL_PATH}")
    print(f"  Classes : {CLASSES}")
    print()

    # ── Load splits ───────────────────────────────────────────────
    print("Loading features …")
    X_train, y_train = load_split("train")
    X_valid, y_valid = load_split("valid")
    X_test,  y_test  = load_split("test")

    print(f"\n  Shapes → train: {X_train.shape}  "
          f"valid: {X_valid.shape}  test: {X_test.shape}")

    if X_train.shape[0] == 0:
        print("  ✗ No training data found. Aborting.")
        return

    # ── Encode labels ─────────────────────────────────────────────
    le = LabelEncoder()
    le.fit(CLASSES)
    y_tr = le.transform(y_train)
    y_va = le.transform(y_valid) if y_valid else np.array([])
    y_te = le.transform(y_test)  if y_test  else np.array([])

    print(f"\n  Label encoding: {dict(zip(le.classes_, le.transform(le.classes_)))}")

    # ── Combine train + valid for tuning & final training ──────────
    X_tv = np.vstack([X_train] + ([X_valid] if len(X_valid) else []))
    y_tv = np.concatenate([y_tr] + ([y_va]  if len(y_va)    else []))

    # ── GridSearchCV: find best C and gamma ───────────────────────
    print("\nRunning GridSearchCV for best SVM hyperparameters …")
    param_grid = {
        "svm__C":     [0.1, 1, 5, 10, 50, 100],
        "svm__gamma": ["scale", "auto", 0.001, 0.01, 0.1],
    }
    base_pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("svm",    SVC(
            kernel="rbf",
            probability=True,
            random_state=SEED,
            class_weight="balanced",
        ))
    ])
    cv_strat = StratifiedKFold(n_splits=5, shuffle=True, random_state=SEED)
    grid_search = GridSearchCV(
        base_pipeline,
        param_grid,
        cv=cv_strat,
        scoring="balanced_accuracy",  # optimises for both classes equally
        n_jobs=-1,
        verbose=1,
        refit=True,
    )
    grid_search.fit(X_tv, y_tv)
    print(f"  Best params : {grid_search.best_params_}")
    print(f"  Best CV balanced accuracy: {grid_search.best_score_:.4f}")

    # ── Build final pipeline with best params, train on train+valid ─
    best_C     = grid_search.best_params_["svm__C"]
    best_gamma = grid_search.best_params_["svm__gamma"]
    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("svm",    SVC(
            kernel="rbf",
            C=best_C,
            gamma=best_gamma,
            probability=True,
            random_state=SEED,
            class_weight="balanced",
        ))
    ])

    # ── 5-fold CV report on train+valid with tuned params ─────────
    print("\nRunning 5-fold CV with tuned params (accuracy + balanced accuracy + log loss) …")
    cv_acc  = cross_val_score(pipeline, X_tv, y_tv, cv=cv_strat,
                              scoring="accuracy", n_jobs=-1)
    cv_bacc = cross_val_score(pipeline, X_tv, y_tv, cv=cv_strat,
                              scoring="balanced_accuracy", n_jobs=-1)
    cv_nll = -cross_val_score(pipeline, X_tv, y_tv, cv=cv_strat,
                              scoring="neg_log_loss", n_jobs=-1)
    print(f"  CV accuracy          : {cv_acc.mean():.4f} ± {cv_acc.std():.4f}")
    print(f"  CV balanced accuracy : {cv_bacc.mean():.4f} ± {cv_bacc.std():.4f}")
    print(f"  CV log loss          : {cv_nll.mean():.4f} ± {cv_nll.std():.4f}")
    print(f"  Fold scores          : {[f'{s:.4f}' for s in cv_acc]}")

    # ── Final training on train+valid ─────────────────────────────
    print("\nFitting final model on train+valid set …")
    pipeline.fit(X_tv, y_tv)

    # Loss-like diagnostic for SVM (probabilistic cross-entropy).
    tv_nll = float(log_loss(y_tv, pipeline.predict_proba(X_tv), labels=np.unique(y_tv)))
    te_nll = float(log_loss(y_te, pipeline.predict_proba(X_test), labels=np.unique(y_tv))) if len(X_test) > 0 else np.nan

    # ── Evaluate ──────────────────────────────────────────────────
    def evaluate(X, y_true_enc, split_name):
        if len(X) == 0:
            return
        y_pred = pipeline.predict(X)
        acc  = accuracy_score(y_true_enc, y_pred)
        bacc = balanced_accuracy_score(y_true_enc, y_pred)
        print(f"\n── {split_name} evaluation (n={len(X)}) ──────────────────────")
        print(f"  Accuracy          : {acc:.4f}")
        print(f"  Balanced Accuracy : {bacc:.4f}")
        print()
        print(classification_report(y_true_enc, y_pred,
                                    target_names=le.classes_,
                                    zero_division=0))
        cm = confusion_matrix(y_true_enc, y_pred)
        print("  Confusion matrix (rows=actual, cols=predicted):")
        header = "         " + "  ".join(f"{c:>10}" for c in le.classes_)
        print(header)
        for i, row in enumerate(cm):
            actual = f"{le.classes_[i]:>8} "
            print(actual + "  ".join(f"{v:>10}" for v in row))
        # Per-class probability distribution check
        proba = pipeline.predict_proba(X)
        print(f"\n  Avg predicted probability per class:")
        for i, cls in enumerate(le.classes_):
            mask = y_true_enc == i
            if mask.sum() > 0:
                avg_p = proba[mask, i].mean()
                print(f"    {cls:>12}: {avg_p:.3f} (n={mask.sum()})")

    # Train+valid were used for fitting — scores here are optimistic (in-sample)
    evaluate(X_tv, y_tv, "TRAIN+VALID (in-sample, optimistic)")
    # Test is the only unbiased holdout
    if len(X_test) > 0:
        evaluate(X_test, y_te, "TEST (held-out, unbiased)")

    # ── Save model ────────────────────────────────────────────────
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    model_bundle = {
        "classifier"    : pipeline,
        "label_encoder" : le,
        "feature_config": FEATURE_CONFIG,
    }

    with open(MODEL_PATH, "wb") as f:
        pickle.dump(model_bundle, f, protocol=pickle.HIGHEST_PROTOCOL)

    size_kb = MODEL_PATH.stat().st_size / 1024
    print(f"\n✅ Model saved → {MODEL_PATH}  ({size_kb:.1f} KB)")

    # ── Generate result plots ─────────────────────────────────────
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    class_names = list(le.classes_)
    n_classes   = len(class_names)

    # Compute test predictions once for all plots
    if len(X_test) > 0:
        y_pred_test  = pipeline.predict(X_test)
        y_proba_test = pipeline.predict_proba(X_test)
    else:
        y_pred_test  = np.array([])
        y_proba_test = np.empty((0, n_classes))

    # ── 1. results.png ── line-graph style (similar to train_model2.py) ──
    n_folds      = len(cv_acc)
    fold_range   = range(1, n_folds + 1)
    test_acc     = float(accuracy_score(y_te, y_pred_test))          if len(y_pred_test) else 0.0
    test_bacc    = float(balanced_accuracy_score(y_te, y_pred_test)) if len(y_pred_test) else 0.0
    test_nll     = te_nll if len(y_pred_test) else np.nan
    split_labels = ['Train+Valid\n(in-sample)', 'Test']

    fig, axes = plt.subplots(2, 3, figsize=(20, 8))
    fig.suptitle(
        f'Training Results – Acoustic SVM\n({n_classes} classes: {", ".join(class_names)})',
        fontsize=13
    )

    # Small moving average helper for cleaner trend lines.
    def smooth_curve(values: np.ndarray, window: int = 3) -> np.ndarray:
        if len(values) < window:
            return values
        return np.convolve(values, np.ones(window) / window, mode='same')

    ax = axes[0][0]
    ax.plot(fold_range, cv_nll, 'g-o', linewidth=2, markersize=5, label='results')
    ax.plot(fold_range, smooth_curve(cv_nll), 'r:', linewidth=2, label='smooth')
    ax.set_title('train/log_loss (CV folds)')
    ax.set_xlabel('Fold')
    ax.set_ylim(bottom=0)
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3)

    ax = axes[0][1]
    ax.plot(fold_range, cv_bacc, 'g-o', linewidth=2, markersize=5, label='results')
    ax.plot(fold_range, smooth_curve(cv_bacc), 'r:', linewidth=2, label='smooth')
    ax.set_title('train/balanced_accuracy (CV folds)')
    ax.set_xlabel('Fold')
    ax.set_ylim(0, 1.1)
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3)

    ax = axes[0][2]
    ax.plot(fold_range, cv_bacc, 'g-o', linewidth=2, markersize=5, label='results')
    ax.plot(fold_range, smooth_curve(cv_bacc), 'r:', linewidth=2, label='smooth')
    ax.set_title('train/balanced_accuracy (CV folds)')
    ax.set_xlabel('Fold')
    ax.set_ylim(0, 1.1)
    ax.legend(fontsize=8)
    ax.grid(True, alpha=0.3)

    def plot_split_metric(ax, values: list[float], title: str, y_min_zero: bool = False, y_max: float | None = None):
        if not np.isnan(values[1]):
            x_vals = np.arange(len(split_labels))
            y_vals = values
            tick_labels = split_labels
        else:
            x_vals = np.array([0])
            y_vals = [values[0]]
            tick_labels = [split_labels[0]]

        ax.plot(x_vals, y_vals, 'g-o', linewidth=2, markersize=6, label='results')
        for x, val in zip(x_vals, y_vals):
            ax.text(x, val + 0.01, f'{val:.3f}', ha='center', fontsize=10)
        ax.set_title(title)
        ax.set_xticks(x_vals)
        ax.set_xticklabels(tick_labels)
        if y_min_zero:
            ax.set_ylim(bottom=0)
        if y_max is not None:
            ymin, _ = ax.get_ylim()
            ax.set_ylim(ymin, y_max)
        ax.legend(fontsize=8)
        ax.grid(axis='y', alpha=0.3)

    acc_vals  = [cv_acc.mean(),  test_acc if len(y_pred_test) else np.nan]
    bacc_vals = [cv_bacc.mean(), test_bacc if len(y_pred_test) else np.nan]
    loss_vals = [tv_nll, test_nll]

    plot_split_metric(axes[1][0], loss_vals, 'val/log_loss', y_min_zero=True)
    plot_split_metric(axes[1][1], acc_vals, 'val/accuracy', y_min_zero=True, y_max=1.05)
    plot_split_metric(axes[1][2], bacc_vals, 'val/balanced_accuracy', y_min_zero=True, y_max=1.05)

    plt.tight_layout()
    results_path = str(RESULTS_DIR / 'results.png')
    plt.savefig(results_path, dpi=150)
    plt.close()
    print(f"Results saved to: {results_path}")

    if len(y_pred_test) > 0:
        # ── 2. confusion_matrix.png ───────────────────────────────
        cm      = confusion_matrix(y_te, y_pred_test)
        cm_norm = cm.astype('float') / cm.sum(axis=1)[:, np.newaxis]
        cm_disp = cm_norm.T  # rows=Predicted, cols=True

        fig_cm, ax_cm = plt.subplots(figsize=(6, 5))
        sns.heatmap(cm_disp, annot=True, fmt='.2f', cmap='Greens', ax=ax_cm,
                    xticklabels=class_names, yticklabels=class_names, vmin=0, vmax=1)
        ax_cm.set_title('Confusion Matrix Normalized')
        ax_cm.set_ylabel('Predicted')
        ax_cm.set_xlabel('True')
        fig_cm.tight_layout()
        cm_path = str(RESULTS_DIR / 'confusion_matrix.png')
        fig_cm.savefig(cm_path, dpi=150)
        plt.close()
        print(f"Confusion matrix saved to: {cm_path}")

        # ── 3. PR_curve.png ───────────────────────────────────────
        y_te_bin = label_binarize(y_te, classes=list(range(n_classes)))
        if n_classes == 2:
            y_te_bin = np.hstack([1 - y_te_bin, y_te_bin])

        fig_pr, ax_pr = plt.subplots(figsize=(7, 5))
        colors = ['#006400', '#228B22', '#32CD32', '#90EE90']
        for i, cls in enumerate(class_names):
            prec_vals, rec_vals, _ = precision_recall_curve(y_te_bin[:, i], y_proba_test[:, i])
            ap = average_precision_score(y_te_bin[:, i], y_proba_test[:, i])
            ax_pr.plot(rec_vals, prec_vals, color=colors[i % len(colors)],
                       label=f'{cls} {ap:.3f}')
        mAP = average_precision_score(y_te_bin, y_proba_test, average='macro')
        ax_pr.plot([], [], ' ', label=f'all classes {mAP:.3f} mAP@0.5')
        ax_pr.set_xlabel('Recall')
        ax_pr.set_ylabel('Precision')
        ax_pr.set_title('Precision-Recall Curve')
        ax_pr.legend(loc='upper right')
        ax_pr.grid(True, alpha=0.3)
        ax_pr.set_xlim([0, 1])
        ax_pr.set_ylim([0, 1.05])
        fig_pr.tight_layout()
        pr_path = str(RESULTS_DIR / 'PR_curve.png')
        fig_pr.savefig(pr_path, dpi=150)
        plt.close()
        print(f"PR curve saved to: {pr_path}")

        # ── 4. model_testing.png ──────────────────────────────────
        macro_prec = precision_score(y_te, y_pred_test, average='macro', zero_division=0)
        macro_rec  = recall_score(y_te, y_pred_test, average='macro', zero_division=0)
        avg_prec   = average_precision_score(y_te_bin, y_proba_test, average='macro')

        bar_labels = ['Precision', 'Recall', 'Average Precision (AP)']
        bar_values = [macro_prec, macro_rec, avg_prec]
        bar_colors = ['#4CAF50', '#66BB6A', '#A5D6A7']

        fig_mt, ax_mt = plt.subplots(figsize=(7, 5))
        bars = ax_mt.bar(bar_labels, bar_values, color=bar_colors, width=0.5)
        ax_mt.set_ylim(0, max(bar_values) * 1.2 if max(bar_values) > 0 else 1.0)
        ax_mt.set_title('Model Testing')
        ax_mt.set_ylabel('Score')
        ax_mt.grid(axis='y', alpha=0.3)
        for bar, val in zip(bars, bar_values):
            ax_mt.text(bar.get_x() + bar.get_width() / 2, bar.get_height() + 0.01,
                       f'{val:.3f}', ha='center', va='bottom', fontsize=10)
        fig_mt.tight_layout()
        mt_path = str(RESULTS_DIR / 'model_testing.png')
        fig_mt.savefig(mt_path, dpi=150)
        plt.close()
        print(f"Model testing chart saved to: {mt_path}")
    else:
        print("⚠  No test data – skipping confusion matrix, PR curve, and model testing charts.")

    print("=" * 60 + "\n")


if __name__ == "__main__":
    train()
