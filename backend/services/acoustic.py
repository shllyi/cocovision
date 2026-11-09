"""
Acoustic Analysis Service for Coconut Maturity Detection

This service analyzes audio recordings (tapping sounds) to predict
coconut maturity stages using audio feature extraction and ML classification.
"""

import numpy as np
import pickle
import os
import logging
import tempfile
import subprocess
import shutil
from pathlib import Path

logger = logging.getLogger("uvicorn")

# ============================================================================
# Configuration
# ============================================================================

# Three different acoustic models
ACOUSTIC_MODEL_PATH = os.path.join(
    os.path.dirname(__file__), "..", "models", "coconut_acoustic_model.pkl"
)
ACOUSTIC_MODEL2_PATH = os.path.join(
    os.path.dirname(__file__), "..", "models", "coconut_acoustic_modelresults.pkl"
)

MATURITY_STAGES = ['malauhog', 'malakanin']

ADVICE = {
    "malauhog": "Buko juice stage. The meat is thin and translucent. Good for juice extraction.",
    "malakanin": "Soft meat stage. Perfect for fruit salads and desserts."
}


def generate_stage_description(stage: str, metrics: dict, tap_analysis: dict) -> str:
    """
    Generate a natural-language explanation for why the audio was classified
    as a particular maturity stage, using the actual measured acoustic metrics.
    """
    rms_db          = metrics.get('rms_energy_db', -40)
    spectral_hz     = metrics.get('spectral_centroid_hz', 0)
    dominant_hz     = metrics.get('dominant_frequency_hz', 0)

    # Describe energy level
    if rms_db > -15:
        energy_desc = "a loud, strong tap"
    elif rms_db > -30:
        energy_desc = "a moderate, clear tap"
    else:
        energy_desc = "a soft, quiet tap"

    # Describe tonal character
    if spectral_hz > 3500:
        tone_desc = "bright, high-pitched ringing tone"
    elif spectral_hz > 2000:
        tone_desc = "mid-range tone with noticeable resonance"
    elif spectral_hz > 1000:
        tone_desc = "slightly hollow, lower-mid tone"
    else:
        tone_desc = "deep, dull thud with little resonance"

    # Count how many taps agreed with the overall result
    agreeing = sum(
        1 for t in ['tap1', 'tap2', 'tap3']
        if tap_analysis.get(t, {}).get('stage') == stage
    )
    tap_agreement = (
        "All three tap segments agreed on this classification."
        if agreeing == 3 else
        f"{agreeing} out of 3 tap segments agreed on this classification."
    )

    if stage == "malauhog":
        return (
            f"The coconut was classified as malauhog (young buko stage) because the taps produced "
            f"{energy_desc} with a {tone_desc} (spectral centroid {spectral_hz:.0f} Hz, "
            f"dominant frequency {dominant_hz:.0f} Hz). "
            f"A young coconut\'s hollow, liquid-filled interior acts like a resonating chamber — "
            f"when struck, it rings with higher-frequency content and less low-end absorption. "
            f"The thin shell and abundant juice inside prevent the sound from being dampened, "
            f"resulting in that characteristic bright, resonant \"tuk-tuk\" sound. "
            f"{tap_agreement}"
        )
    elif stage == "malakanin":
        return (
            f"The coconut was classified as malakanin (mature, soft-meat stage) because the taps produced "
            f"{energy_desc} with a {tone_desc} (spectral centroid {spectral_hz:.0f} Hz, "
            f"dominant frequency {dominant_hz:.0f} Hz). "
            f"A maturing coconut gradually fills with dense white meat, which absorbs and dampens "
            f"high-frequency vibrations. The solidifying interior shifts the acoustic response "
            f"toward lower frequencies and produces a fuller, more muffled \"thud\" instead of "
            f"the hollow ring of a younger coconut. "
            f"{tap_agreement}"
        )
    else:
        return "Acoustic characteristics were inconclusive for this recording."

TARGET_SAMPLE_RATE = 22050

# ============================================================================
# FFmpeg Check and Configuration
# ============================================================================

def find_ffmpeg_path() -> str:
    """Find FFmpeg executable path."""
    import shutil
    
    # Try to find ffmpeg in PATH
    ffmpeg_path = shutil.which('ffmpeg')
    if ffmpeg_path:
        return ffmpeg_path
    
    # Check common Windows installation paths
    common_paths = [
        r"C:\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files\ffmpeg\bin\ffmpeg.exe",
        r"C:\Program Files (x86)\ffmpeg\bin\ffmpeg.exe",
        os.path.expanduser(r"~\ffmpeg\bin\ffmpeg.exe"),
        r"C:\Users\Jett\AppData\Local\Microsoft\WinGet\Packages\Gyan.FFmpeg_Microsoft.WinGet.Source_8wekyb3d8bbwe\ffmpeg-8.0.1-full_build\bin\ffmpeg.exe",
    ]
    
    for path in common_paths:
        if os.path.exists(path):
            logger.info(f"Found FFmpeg at: {path}")
            return path
    
    return None

def check_ffmpeg_available() -> bool:
    """Check if FFmpeg is available on the system."""
    try:
        ffmpeg = find_ffmpeg_path()
        if not ffmpeg:
            return False
        result = subprocess.run(
            [ffmpeg, '-version'], 
            capture_output=True, 
            text=True, 
            timeout=5
        )
        return result.returncode == 0
    except (FileNotFoundError, subprocess.TimeoutExpired, Exception):
        return False

FFMPEG_PATH = find_ffmpeg_path()
FFMPEG_AVAILABLE = check_ffmpeg_available()
logger.info(f"FFmpeg path: {FFMPEG_PATH}")
logger.info(f"FFmpeg available: {FFMPEG_AVAILABLE}")

# Configure pydub to use FFmpeg
if FFMPEG_PATH:
    from pydub import AudioSegment
    ffmpeg_dir = os.path.dirname(FFMPEG_PATH)
    AudioSegment.converter = FFMPEG_PATH
    AudioSegment.ffmpeg = FFMPEG_PATH
    logger.info(f"Configured pydub to use FFmpeg at: {FFMPEG_PATH}")

# ============================================================================
# Model Loading
# ============================================================================

acoustic_model = None
acoustic_model2 = None

def load_acoustic_model_from_path(model_path: str, model_name: str):
    """Load a single acoustic classification model from path."""
    model_path = Path(model_path).resolve()
    logger.info(f"Loading {model_name} from: {model_path}")
    
    if not model_path.exists():
        models_dir = model_path.parent
        if models_dir.exists():
            available = os.listdir(models_dir)
            logger.error(f"{model_name} not found. Available models: {available}")
        else:
            logger.error("Models directory not found")
        return None
    
    try:
        with open(model_path, 'rb') as f:
            model = pickle.load(f)
        
        # Verify model structure
        if isinstance(model, dict):
            if 'classifier' in model and 'label_encoder' in model:
                logger.info(f"{model_name} loaded successfully as dictionary with keys: {list(model.keys())}")
                logger.info(f"Classifier type: {type(model['classifier']).__name__}")
                return model
            else:
                logger.error(f"{model_name} dictionary missing required keys 'classifier' and/or 'label_encoder'")
                return None
        else:
            logger.info(f"{model_name} loaded successfully: {type(model).__name__}")
            return model
            
    except Exception as e:
        logger.error(f"Failed to load {model_name}: {e}", exc_info=True)
        return None

def load_acoustic_models():
    """Load both acoustic classification models."""
    global acoustic_model, acoustic_model2
    
    logger.info("Starting model loading process...")
    acoustic_model = load_acoustic_model_from_path(ACOUSTIC_MODEL_PATH, "Internet-sourced Model")
    acoustic_model2 = load_acoustic_model_from_path(ACOUSTIC_MODEL2_PATH, "Own Dataset Model (Augmented – acoustic_new)")
    
    logger.info(f"Model loading complete - Internet-sourced: {acoustic_model is not None}, Augmented: {acoustic_model2 is not None}")
    
    if acoustic_model is None:
        logger.warning("Internet-sourced model failed to load")
    if acoustic_model2 is None:
        logger.warning("Own dataset augmented model failed to load")

# Load models on module import
load_acoustic_models()

# ============================================================================
# Audio Format Detection
# ============================================================================

def detect_audio_format(data: bytes) -> str:
    """Detect audio format from file header bytes."""
    if len(data) < 12:
        return "unknown"
    
    # WAV: RIFF....WAVE
    if data.startswith(b'RIFF') and b'WAVE' in data[:12]:
        return "wav"
    
    # WebM/Matroska
    if data.startswith(b'\x1aE\xdf\xa3'):
        return "webm"
    
    # Ogg
    if data.startswith(b'OggS'):
        return "ogg"
    
    # MP3: ID3 tag or sync bytes
    if data.startswith(b'ID3') or data[:2] == b'\xff\xfb':
        return "mp3"
    
    # M4A/AAC: ftyp box
    if b'ftyp' in data[:12]:
        return "m4a"
    
    # CAF (Core Audio Format)
    if data.startswith(b'caff'):
        return "caf"
    
    return "unknown"

# ============================================================================
# Audio Loading Functions
# ============================================================================

def load_audio_scipy(file_path: str) -> tuple:
    """Load audio using scipy wavfile (WAV only)."""
    try:
        from scipy.io import wavfile
        sr, y = wavfile.read(file_path)
        
        # Convert to float32 normalized [-1, 1]
        if y.dtype == np.int16:
            y = y.astype(np.float32) / 32768.0
        elif y.dtype == np.int32:
            y = y.astype(np.float32) / 2147483648.0
        elif y.dtype == np.uint8:
            y = (y.astype(np.float32) - 128) / 128.0
        else:
            y = y.astype(np.float32)
        
        # Convert stereo to mono
        if len(y.shape) > 1:
            y = y.mean(axis=1)
        
        logger.info(f"scipy loaded: {len(y)} samples @ {sr}Hz")
        return y, sr
    except Exception as e:
        logger.debug(f"scipy load failed: {e}")
        return None, None


def load_audio_librosa(file_path: str) -> tuple:
    """Load audio using librosa."""
    try:
        import librosa
        y, sr = librosa.load(file_path, sr=TARGET_SAMPLE_RATE)
        logger.info(f"librosa loaded: {len(y)} samples @ {sr}Hz")
        return y, sr
    except Exception as e:
        logger.debug(f"librosa load failed: {e}")
        return None, None


def load_audio_soundfile(file_path: str) -> tuple:
    """Load audio using soundfile."""
    try:
        import soundfile as sf
        data, sr = sf.read(file_path)
        y = data.astype(np.float32)
        
        # Convert stereo to mono
        if len(y.shape) > 1:
            y = y.mean(axis=1)
        
        logger.info(f"soundfile loaded: {len(y)} samples @ {sr}Hz")
        return y, sr
    except Exception as e:
        logger.debug(f"soundfile load failed: {e}")
        return None, None


def load_audio_pydub(file_path: str) -> tuple:
    """Load audio using pydub (requires FFmpeg for non-WAV)."""
    try:
        from pydub import AudioSegment
        
        audio = AudioSegment.from_file(file_path)
        logger.info(f"pydub loaded: {audio.duration_seconds:.2f}s @ {audio.frame_rate}Hz")
        
        # Convert to numpy array
        samples = np.array(audio.get_array_of_samples())
        
        # Handle stereo
        if audio.channels == 2:
            samples = samples.reshape((-1, 2)).mean(axis=1)
        
        sr = audio.frame_rate
        # Use the correct divisor for the actual bit depth (16-bit → 32768, 24-bit → 8388608, 32-bit → 2147483648)
        max_val = float(1 << (8 * audio.sample_width - 1))
        y = samples.astype(np.float32) / max_val
        
        return y, sr
    except Exception as e:
        logger.debug(f"pydub load failed: {e}")
        return None, None


def convert_with_ffmpeg(input_path: str, output_path: str) -> bool:
    """Convert audio to WAV using FFmpeg."""
    if not FFMPEG_AVAILABLE or not FFMPEG_PATH:
        return False
    
    try:
        cmd = [
            FFMPEG_PATH, '-y', '-i', input_path,
            '-acodec', 'pcm_s16le',
            '-ar', str(TARGET_SAMPLE_RATE),
            '-ac', '1',
            output_path
        ]
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=30)
        
        if result.returncode == 0 and os.path.exists(output_path):
            logger.info("FFmpeg conversion successful")
            return True
        else:
            logger.debug(f"FFmpeg failed: {result.stderr}")
            return False
    except Exception as e:
        logger.debug(f"FFmpeg error: {e}")
        return False


def load_audio(file_path: str, audio_format: str) -> tuple:
    """
    Load audio file using various methods with fallbacks.
    Returns (audio_samples, sample_rate) or raises Exception.
    """
    y, sr = None, None
    
    logger.info(f"Attempting to load {audio_format} audio from {file_path}")
    
    # For WebM/OGG/MP3/M4A, try pydub first (requires FFmpeg)
    if audio_format in ["webm", "ogg", "mp3", "m4a"]:
        logger.info(f"WebM/compressed format - trying pydub with FFmpeg...")
        y, sr = load_audio_pydub(file_path)
        if y is not None:
            return y, sr
    
    # Method 1: For WAV files, try scipy first (fastest)
    if audio_format == "wav":
        y, sr = load_audio_scipy(file_path)
        if y is not None:
            return y, sr
    
    # Method 2: Try librosa (handles many formats with audioread backend)
    logger.info("Trying librosa...")
    y, sr = load_audio_librosa(file_path)
    if y is not None:
        return y, sr
    
    # Method 3: Try soundfile
    logger.info("Trying soundfile...")
    y, sr = load_audio_soundfile(file_path)
    if y is not None:
        return y, sr
    
    # Method 4: Try pydub again (in case it wasn't tried yet)
    if audio_format != "wav":
        logger.info("Trying pydub again...")
        y, sr = load_audio_pydub(file_path)
        if y is not None:
            return y, sr
    
    # Method 5: Convert with FFmpeg and try again
    if FFMPEG_AVAILABLE and FFMPEG_PATH:
        logger.info("Converting with FFmpeg...")
        wav_path = file_path + ".converted.wav"
        try:
            if convert_with_ffmpeg(file_path, wav_path):
                y, sr = load_audio_scipy(wav_path)
                if y is not None:
                    return y, sr
        finally:
            if os.path.exists(wav_path):
                os.remove(wav_path)
    
    error_msg = f"Could not load audio file (format: {audio_format}). "
    if not FFMPEG_AVAILABLE:
        error_msg += "FFmpeg not found - required for WebM/OGG/MP3 formats."
    else:
        error_msg += f"All methods failed. FFmpeg: {FFMPEG_PATH}"
    
    raise Exception(error_msg)

# ============================================================================
# Feature Extraction
# ============================================================================

def extract_features(y: np.ndarray, sr: int) -> np.ndarray:
    """
    Extract audio features for classification.
    
    The model expects 132,300 features, which corresponds to 6 seconds of
    raw audio data at 22.05kHz sample rate. We'll use the raw audio samples
    directly as features.
    
    Args:
        y: Audio samples
        sr: Sample rate
        
    Returns:
        np.ndarray: Raw audio samples (132,300 features)
    """
    # Ensure we have exactly 132,300 samples (6 seconds at 22.05kHz)
    target_length = 132300
    
    if len(y) < target_length:
        # Pad with zeros if too short
        logger.info(f"Padding audio from {len(y)} to {target_length} samples")
        features = np.pad(y, (0, target_length - len(y)), mode='constant')
    elif len(y) > target_length:
        # Trim if too long
        logger.info(f"Trimming audio from {len(y)} to {target_length} samples")
        features = y[:target_length]
    else:
        features = y
    
    logger.info(f"Features ready: {len(features)} samples ({len(features)/sr:.2f}s)")
    
    return features


def preprocess_for_own_dataset(y: np.ndarray, sr: int, duration: float = 5.0, top_db: int = 30) -> np.ndarray:
    """
    Apply the exact same preprocessing used in acoustic_augment_distribute.py
    during training of the "Your Dataset" model:
      1. Trim leading/trailing silence
      2. Normalize amplitude to [-1, 1]
      3. Crop from centre (or pad) to exactly `duration` seconds
    Skipping this step causes feature distribution mismatch → always same class.
    """
    import librosa as _librosa

    # 1. Trim silence
    y_trimmed, _ = _librosa.effects.trim(y, top_db=top_db)

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


def extract_librosa_features(y: np.ndarray, sr: int, cfg: dict) -> np.ndarray:
    """
    Extract the same 370-dimensional librosa feature vector used when training
    coconut_acoustic_model3.pkl  (MFCCs, Chroma, Mel, spectral stats, ZCR, RMS).
    This MUST stay in sync with train_acoustic_model.py :: extract_features().
    """
    import librosa as _librosa

    n_fft      = cfg.get("n_fft",       2048)
    hop_length = cfg.get("hop_length",   512)
    n_mfcc     = cfg.get("n_mfcc",        40)
    n_chroma   = cfg.get("n_chroma",      12)
    n_mels     = cfg.get("n_mels",       128)

    feats = []

    # 1. MFCCs (mean + std → 2 × n_mfcc)
    mfcc = _librosa.feature.mfcc(y=y, sr=sr, n_mfcc=n_mfcc,
                                  n_fft=n_fft, hop_length=hop_length)
    feats.extend(np.mean(mfcc, axis=1))
    feats.extend(np.std(mfcc, axis=1))

    # 2. Chroma (mean + std → 2 × n_chroma)
    chroma = _librosa.feature.chroma_stft(y=y, sr=sr, n_chroma=n_chroma,
                                           n_fft=n_fft, hop_length=hop_length)
    feats.extend(np.mean(chroma, axis=1))
    feats.extend(np.std(chroma, axis=1))

    # 3. Mel-spectrogram (mean + std → 2 × n_mels)
    mel = _librosa.feature.melspectrogram(y=y, sr=sr, n_mels=n_mels,
                                           n_fft=n_fft, hop_length=hop_length)
    mel_db = _librosa.power_to_db(mel, ref=np.max)
    feats.extend(np.mean(mel_db, axis=1))
    feats.extend(np.std(mel_db, axis=1))

    # 4. Spectral centroid  (mean + std → 2)
    sc = _librosa.feature.spectral_centroid(y=y, sr=sr, n_fft=n_fft, hop_length=hop_length)
    feats.append(float(np.mean(sc)))
    feats.append(float(np.std(sc)))

    # 5. Spectral bandwidth  (mean + std → 2)
    sb = _librosa.feature.spectral_bandwidth(y=y, sr=sr, n_fft=n_fft, hop_length=hop_length)
    feats.append(float(np.mean(sb)))
    feats.append(float(np.std(sb)))

    # 6. Spectral roll-off  (mean + std → 2)
    sro = _librosa.feature.spectral_rolloff(y=y, sr=sr, n_fft=n_fft, hop_length=hop_length)
    feats.append(float(np.mean(sro)))
    feats.append(float(np.std(sro)))

    # 7. Zero-crossing rate  (mean + std → 2)
    zcr = _librosa.feature.zero_crossing_rate(y, hop_length=hop_length)
    feats.append(float(np.mean(zcr)))
    feats.append(float(np.std(zcr)))

    # 8. RMS energy  (mean + std → 2)
    rms = _librosa.feature.rms(y=y, hop_length=hop_length)
    feats.append(float(np.mean(rms)))
    feats.append(float(np.std(rms)))

    return np.array(feats, dtype=np.float32)


# ============================================================================
# Tap Speed Detection
# ============================================================================

def calculate_tap_speed(y: np.ndarray, sr: int, window_duration: float = 5.0) -> dict:
    """
    Estimate tap speed from audio segment.
    
    Detects peaks in energy envelope to identify individual taps and calculate
    timing between them.
    
    Args:
        y: Audio samples
        sr: Sample rate
        window_duration: Expected duration of tap window (in seconds)
        
    Returns:
        dict with tap_speed_bpm, average_tap_interval, and recommendation
    """
    try:
        # Calculate short-term energy envelope with windowing
        frame_length = int(sr * 0.05)  # 50ms frames
        if frame_length < 50:
            frame_length = 50
            
        energy = []
        for i in range(0, len(y) - frame_length, frame_length):
            frame = y[i:i + frame_length]
            energy.append(np.sqrt(np.mean(frame ** 2)))
        
        if len(energy) < 10:
            return {
                "tap_speed_bpm": 0.0,
                "average_tap_interval": 0.0,
                "tap_count_estimate": 0,
                "recommendation": "Unable to detect tap speed from audio"
            }
        
        energy = np.array(energy)
        
        # Detect peaks (taps) using threshold
        threshold = np.mean(energy) + 0.75 * np.std(energy)
        peaks = []
        for i in range(1, len(energy) - 1):
            if energy[i] > threshold and energy[i] > energy[i-1] and energy[i] > energy[i+1]:
                peaks.append(i)
        
        # Filter out closely spaced peaks (minimum 0.5s between taps)
        min_peak_distance = int(0.5 * sr / frame_length)
        filtered_peaks = []
        for peak in peaks:
            if not filtered_peaks or peak - filtered_peaks[-1] > min_peak_distance:
                filtered_peaks.append(peak)
        
        tap_count = len(filtered_peaks)
        
        if tap_count < 2:
            return {
                "tap_speed_bpm": 0.0,
                "average_tap_interval": 0.0,
                "tap_count_estimate": tap_count,
                "recommendation": "Could not reliably detect tap timing. Try tapping more clearly and consistently."
            }
        
        # Calculate intervals between consecutive taps
        intervals_frames = [filtered_peaks[i+1] - filtered_peaks[i] for i in range(len(filtered_peaks)-1)]
        intervals_seconds = [interval * frame_length / sr for interval in intervals_frames]
        
        average_interval = np.mean(intervals_seconds)
        tap_speed_bpm = 60.0 / average_interval if average_interval > 0 else 0.0
        
        # Determine recommendation with stricter thresholds
        # Ideal range: 60-90 BPM (1-1.5 taps per second)
        if tap_speed_bpm < 40:
            recommendation = f"Taps were too slow ({tap_speed_bpm:.1f} BPM). Try tapping faster - aim for 60-90 BPM (1-1.5 taps/sec) next time."
        elif tap_speed_bpm < 60:
            recommendation = f"Taps were a bit slow ({tap_speed_bpm:.1f} BPM). Try tapping slightly faster - aim for 60-90 BPM next time."
        elif tap_speed_bpm <= 90:
            recommendation = f"Tap speed was good ({tap_speed_bpm:.1f} BPM). Keep this consistent tempo for accurate results."
        elif tap_speed_bpm <= 120:
            recommendation = f"Taps were a bit fast ({tap_speed_bpm:.1f} BPM). Try tapping slightly slower - aim for 60-90 BPM next time."
        else:
            recommendation = f"Taps were too fast ({tap_speed_bpm:.1f} BPM). Try tapping slower - aim for 60-90 BPM (1-1.5 taps/sec) next time."
        
        logger.info(f"Tap detection: {tap_count} taps detected, avg interval {average_interval:.2f}s, speed {tap_speed_bpm:.1f} BPM")
        
        return {
            "tap_speed_bpm": float(tap_speed_bpm),
            "average_tap_interval": float(average_interval),
            "tap_count_estimate": int(tap_count),
            "recommendation": recommendation
        }
    except Exception as e:
        logger.error(f"Tap speed calculation failed: {e}")
        return {
            "tap_speed_bpm": 0.0,
            "average_tap_interval": 0.0,
            "tap_count_estimate": 0,
            "recommendation": "Error detecting tap speed"
        }


# ============================================================================
# Tap Analysis (Individual Tap Segment Analysis)
# ============================================================================

def analyze_tap_segment(y: np.ndarray, sr: int, classifier, feature_config: dict = None, label_encoder=None) -> dict:
    """
    Analyze a single tap segment by extracting features and predicting.

    When feature_config is provided the model expects the 370-dim librosa
    feature vector (MFCCs, Chroma, Mel, spectral stats, ZCR, RMS) — i.e. the
    "Your Dataset" model.  Otherwise raw 132,300-sample waveform is used.

    label_encoder: the sklearn LabelEncoder from the model bundle ("Your Dataset"
    only). When provided, class indices are decoded using the encoder's ordering
    instead of MATURITY_STAGES, fixing the alphabetical vs. manual order mismatch.
    """
    try:
        # --- Feature extraction -----------------------------------------
        if feature_config:
            # Librosa feature vector (370 dims) — for "Your Dataset" model
            # Resample to the sample rate the model was trained on if needed
            import librosa as _librosa
            target_sr = feature_config.get("sample_rate", 22050)
            y_feat = y
            if sr != target_sr:
                y_feat = _librosa.resample(y, orig_sr=sr, target_sr=target_sr)
                sr_feat = target_sr
            else:
                sr_feat = sr
            # Apply the SAME preprocessing used during training:
            # silence trim → normalize → crop/pad to 5 s
            y_feat = preprocess_for_own_dataset(y_feat, sr_feat)
            features_for_model = extract_librosa_features(y_feat, sr_feat, feature_config)
        else:
            # Raw waveform (132,300 samples) — for Internet-sourced model
            target_length = 132300
            if len(y) < target_length:
                features_for_model = np.pad(y, (0, target_length - len(y)), mode='constant')
            elif len(y) > target_length:
                features_for_model = y[:target_length]
            else:
                features_for_model = y

        # --- Prediction -------------------------------------------------
        prediction = classifier.predict(features_for_model.reshape(1, -1))
        probabilities = classifier.predict_proba(features_for_model.reshape(1, -1))[0]

        # "Your Dataset" model: use the saved label_encoder so that probability
        # indices map to class names in training order (alphabetical: malakanin=0,
        # malauhog=1).  Original Model: keep the existing MATURITY_STAGES path.
        if feature_config is not None and label_encoder is not None:
            class_names = list(label_encoder.classes_)
            stage_idx = int(np.argmax(probabilities[:len(class_names)]))
            stage_idx = max(0, min(stage_idx, len(class_names) - 1))
            stage = class_names[stage_idx]
            confidence = float(probabilities[stage_idx])
            prob_dict = {class_names[i]: float(probabilities[i])
                         for i in range(min(len(class_names), len(probabilities)))}
            # Ensure every MATURITY_STAGES key exists for UI compatibility
            for s in MATURITY_STAGES:
                prob_dict.setdefault(s, 0.0)
        else:
            # Original Model path — unchanged
            valid_probs = probabilities[:min(len(probabilities), len(MATURITY_STAGES))]
            stage_idx = int(np.argmax(valid_probs))
            stage_idx = max(0, min(stage_idx, len(MATURITY_STAGES) - 1))
            stage = MATURITY_STAGES[stage_idx]
            confidence = float(probabilities[stage_idx])
            prob_dict = {MATURITY_STAGES[i]: float(probabilities[min(i, len(probabilities)-1)])
                         for i in range(len(MATURITY_STAGES))}

        # Calculate metrics using the raw segment (not the feature vector)
        rms = np.sqrt(np.mean(y ** 2))
        db = 20 * np.log10(rms + 1e-10)

        fft = np.abs(np.fft.fft(y))
        freqs = np.fft.fftfreq(len(y), 1/sr)
        positive_freq_idx = freqs > 0
        if np.any(positive_freq_idx):
            dominant_freq_idx = np.argmax(fft[positive_freq_idx])
            dominant_freq = freqs[positive_freq_idx][dominant_freq_idx]
        else:
            dominant_freq = 0.0
        
        # Calculate tap speed from the original audio segment
        tap_speed_info = calculate_tap_speed(y, sr, window_duration=5.0)
        
        return {
            "stage": stage,
            "confidence": confidence,
            "rms_energy_db": float(db),
            "dominant_frequency_hz": float(dominant_freq),
            "tap_speed_bpm": tap_speed_info.get("tap_speed_bpm", 0.0),
            "average_tap_interval": tap_speed_info.get("average_tap_interval", 0.0),
            "tap_count_estimate": tap_speed_info.get("tap_count_estimate", 0),
            "tap_speed_recommendation": tap_speed_info.get("recommendation", ""),
            "probabilities": prob_dict
        }
    except Exception as e:
        logger.error(f"Tap analysis failed: {e}")
        return {
            "stage": "unknown",
            "confidence": 0.0,
            "rms_energy_db": 0.0,
            "dominant_frequency_hz": 0.0,
            "tap_speed_bpm": 0.0,
            "average_tap_interval": 0.0,
            "tap_count_estimate": 0,
            "tap_speed_recommendation": "",
            "probabilities": {stage: 0.0 for stage in MATURITY_STAGES}
        }


def extract_tap_analysis(y: np.ndarray, sr: int, classifier, feature_config: dict = None, label_encoder=None) -> dict:
    """
    Extract and analyze individual tap segments from the recording.
    Pass feature_config for models that use librosa features ("Your Dataset").
    Pass label_encoder (from the model bundle) for "Your Dataset" so that
    class indices are decoded correctly.
    """
    try:
        tap_analysis = {}

        # Both models use the same fixed tap windows from the same recording.
        # "Your Dataset" additionally applies silence-trim + normalize + crop/pad
        # inside analyze_tap_segment (via preprocess_for_own_dataset) before
        # extracting librosa features, matching its training pipeline exactly.
        tap_windows = {
            "tap1": (4, 10),    # 4-10s: includes prep + tap1 (6 seconds)
            "tap2": (12, 18),   # 12-18s: includes pause1 + tap2 (6 seconds)
            "tap3": (20, 26)    # 20-26s: includes pause2 + tap3 (6 seconds)
        }

        for tap_name, (start_sec, end_sec) in tap_windows.items():
            start_sample = int(start_sec * sr)
            end_sample = int(end_sec * sr)

            tap_segment = y[start_sample:end_sample]

            if len(tap_segment) > 100:
                tap_result = analyze_tap_segment(tap_segment, sr, classifier, feature_config, label_encoder)
                tap_analysis[tap_name] = tap_result
                logger.info(f"{tap_name}: {tap_result['stage']} ({tap_result['confidence']*100:.1f}%)")
            else:
                tap_analysis[tap_name] = {
                    "stage": "unknown",
                    "confidence": 0.0,
                    "rms_energy_db": 0.0,
                    "dominant_frequency_hz": 0.0,
                    "tap_speed_bpm": 0.0,
                    "average_tap_interval": 0.0,
                    "tap_count_estimate": 0,
                    "tap_speed_recommendation": "",
                    "probabilities": {stage: 0.0 for stage in MATURITY_STAGES}
                }

        return tap_analysis
    except Exception as e:
        logger.error(f"Tap extraction failed: {e}")
        empty_tap = {
            "stage": "unknown", 
            "confidence": 0.0, 
            "rms_energy_db": 0.0, 
            "dominant_frequency_hz": 0.0,
            "tap_speed_bpm": 0.0,
            "average_tap_interval": 0.0,
            "tap_count_estimate": 0,
            "tap_speed_recommendation": "",
            "probabilities": {}
        }
        return {
            "tap1": empty_tap,
            "tap2": empty_tap,
            "tap3": empty_tap
        }


def generate_detailed_reasoning(stage: str, confidence: float, metrics: dict, tap_analysis: dict, all_predictions: dict) -> str:
    """
    Generate detailed explanation for the classification result.
    
    Recording structure analyzed:
    - Tap1 (5-10s): 3 taps with 5 seconds
    - Tap2 (13-18s): 3 taps with 5 seconds
    - Tap3 (21-26s): 3 taps with 5 seconds
    
    Returns:
        str with detailed reasoning
    """
    try:
        reasoning = f"""
🔬 DETAILED ACOUSTIC ANALYSIS

📊 Overall Result: {stage.upper()}
├─ Confidence: {confidence*100:.1f}%
├─ RMS Energy: {metrics.get('rms_energy_db', 0):.2f} dB
├─ Dominant Frequency: {metrics.get('dominant_frequency_hz', 0):.2f} Hz
└─ Spectral Centroid: {metrics.get('spectral_centroid_hz', 0):.2f} Hz

🥥 Classification Explanation:
"""
        
        if stage == "malauhog":
            reasoning += """├─ Indicates: YOUNG COCONUT (Buko Stage)
├─ Characteristics:
│  • Lower RMS energy (soft shell, liquid interior)
│  • Higher frequency content (hollow sound)
│  • More resonant acoustic properties
└─ Best for: Juice extraction, fresh consumption"""
        elif stage == "malakanin":
            reasoning += """├─ Indicates: MATURE COCONUT (Soft Meat Stage)
├─ Characteristics:
│  • Moderate RMS energy (harder shell, solidifying meat)
│  • Lower frequency content (denser acoustic response)
│  • Reduced resonance
└─ Best for: Cooking, grating, desserts"""
        
        reasoning += f"""

📈 Individual Tap Analysis:
├─ TAP 1: {tap_analysis.get('tap1', {}).get('stage', 'N/A').upper()} ({tap_analysis.get('tap1', {}).get('confidence', 0)*100:.1f}%)
│  ├─ Energy: {tap_analysis.get('tap1', {}).get('rms_energy_db', 0):.2f} dB
│  └─ Speed: {tap_analysis.get('tap1', {}).get('tap_speed_bpm', 0):.1f} BPM
├─ TAP 2: {tap_analysis.get('tap2', {}).get('stage', 'N/A').upper()} ({tap_analysis.get('tap2', {}).get('confidence', 0)*100:.1f}%)
│  ├─ Energy: {tap_analysis.get('tap2', {}).get('rms_energy_db', 0):.2f} dB
│  └─ Speed: {tap_analysis.get('tap2', {}).get('tap_speed_bpm', 0):.1f} BPM
└─ TAP 3: {tap_analysis.get('tap3', {}).get('stage', 'N/A').upper()} ({tap_analysis.get('tap3', {}).get('confidence', 0)*100:.1f}%)
   ├─ Energy: {tap_analysis.get('tap3', {}).get('rms_energy_db', 0):.2f} dB
   └─ Speed: {tap_analysis.get('tap3', {}).get('tap_speed_bpm', 0):.1f} BPM

⏱️ Tapping Recommendations:
│  ├─ TAP 1: {tap_analysis.get('tap1', {}).get('tap_speed_recommendation', 'N/A')}
│  ├─ TAP 2: {tap_analysis.get('tap2', {}).get('tap_speed_recommendation', 'N/A')}
│  └─ TAP 3: {tap_analysis.get('tap3', {}).get('tap_speed_recommendation', 'N/A')}

🎯 Confidence Distribution:
"""
        
        for stage_name, score in all_predictions.items():
            bar_length = int(score * 20)
            bar = "█" * bar_length + "░" * (20 - bar_length)
            reasoning += f"└─ {stage_name.upper()}: {bar} {score*100:.1f}%\n"
        
        reasoning += """
💡 Methodology:
├─ Method: Machine Learning Acoustic Classification
├─ Features: 132,300 raw audio samples (6 seconds @ 22.05kHz)
├─ Analysis: Spectral analysis (FFT, harmonic content)
└─ Model Type: Trained classifier using multiple acoustic metrics
"""
        
        return reasoning
    except Exception as e:
        logger.error(f"Reasoning generation failed: {e}")
        return f"Error generating reasoning: {str(e)}"


# ============================================================================
# Acoustic Metrics Extraction
# ============================================================================

def calculate_acoustic_metrics(y: np.ndarray, sr: int) -> dict:
    """
    Calculate acoustic metrics from audio.
    
    Returns:
        dict with frequency and energy metrics
    """
    try:
        # Calculate RMS energy in dB
        rms = np.sqrt(np.mean(y ** 2))
        db = 20 * np.log10(rms + 1e-10)
        
        # Calculate dominant frequency using FFT
        fft = np.abs(np.fft.fft(y))
        freqs = np.fft.fftfreq(len(y), 1/sr)
        
        # Only consider positive frequencies
        positive_freq_idx = freqs > 0
        if np.any(positive_freq_idx):
            dominant_freq_idx = np.argmax(fft[positive_freq_idx])
            dominant_freq = freqs[positive_freq_idx][dominant_freq_idx]
        else:
            dominant_freq = 0.0
        
        # Calculate spectral centroid (average frequency weighted by magnitude)
        magnitude = np.abs(np.fft.fft(y))
        freqs_positive = np.fft.fftfreq(len(y), 1/sr)[:len(y)//2]
        magnitude_positive = magnitude[:len(y)//2]
        
        spectral_centroid = np.sum(freqs_positive * magnitude_positive) / (np.sum(magnitude_positive) + 1e-10)
        
        # Calculate zero crossing rate
        zero_crossings = np.sum(np.abs(np.diff(np.sign(y)))) / 2
        zero_crossing_rate = zero_crossings / len(y)
        
        metrics = {
            "rms_energy_db": float(db),
            "dominant_frequency_hz": float(dominant_freq),
            "spectral_centroid_hz": float(spectral_centroid),
            "zero_crossing_rate": float(zero_crossing_rate),
            "rms_value": float(rms)
        }
        
        logger.info(f"Acoustic metrics - RMS: {db:.2f}dB, Dominant Freq: {dominant_freq:.2f}Hz, Spectral Centroid: {spectral_centroid:.2f}Hz")
        
        return metrics
        
    except Exception as e:
        logger.error(f"Failed to calculate metrics: {e}")
        return {
            "rms_energy_db": 0.0,
            "dominant_frequency_hz": 0.0,
            "spectral_centroid_hz": 0.0,
            "zero_crossing_rate": 0.0,
            "rms_value": 0.0
        }

# ============================================================================
# Main Prediction Function
# ============================================================================

def predict_with_model(model, features: np.ndarray) -> tuple:
    """
    Make prediction with a model (handles both dict and direct classifier formats).
    
    Args:
        model: Model (dict with 'classifier' key or direct classifier)
        features: Feature array to classify
        
    Returns:
        tuple of (stage, confidence, all_predictions_dict)
    """
    try:
        if model is None:
            return "unknown", 0.0, {stage: 0.0 for stage in MATURITY_STAGES}
        
        if isinstance(model, dict) and 'classifier' in model:
            classifier = model['classifier']
        else:
            classifier = model
        
        # Make prediction
        prediction = classifier.predict(features.reshape(1, -1))
        probabilities = classifier.predict_proba(features.reshape(1, -1))[0]
        
        # Get stage
        stage_idx = int(np.argmax(probabilities))
        stage_idx = max(0, min(stage_idx, len(MATURITY_STAGES) - 1))
        stage = MATURITY_STAGES[stage_idx]
        confidence = float(probabilities[stage_idx])
        
        # Build predictions dict
        all_predictions = {MATURITY_STAGES[i]: float(probabilities[min(i, len(probabilities)-1)]) for i in range(len(MATURITY_STAGES))}
        
        return stage, confidence, all_predictions
    except Exception as e:
        logger.error(f"Model prediction failed: {e}")
        return "unknown", 0.0, {stage: 0.0 for stage in MATURITY_STAGES}


async def predict_maturity_from_audio(file) -> dict:
    """
    Analyze audio recording to predict coconut maturity stage using THREE models.
    
    Args:
        file: UploadFile object from FastAPI
        
    Returns:
        dict with results from all three acoustic models
    """
    import librosa
    
    logger.info("=" * 40)
    logger.info("Starting acoustic analysis with THREE models")
    logger.info("=" * 40)
    
    # Check if at least one model is loaded
    if acoustic_model is None and acoustic_model2 is None:
        raise Exception("No acoustic models loaded. Please ensure the model files exist.")
    
    temp_file = None
    
    try:
        # Step 1: Read uploaded file
        logger.info("Reading audio file...")
        audio_data = await file.read()
        file_size = len(audio_data)
        logger.info(f"Received: {file_size} bytes")
        
        if file_size < 100:
            raise Exception("Audio file is too small or empty")
        
        # Step 2: Detect format
        audio_format = detect_audio_format(audio_data)
        logger.info(f"Detected format: {audio_format}")
        
        # Step 3: Save to temp file
        ext = f".{audio_format}" if audio_format != "unknown" else ".audio"
        temp_file = tempfile.NamedTemporaryFile(suffix=ext, delete=False)
        temp_file.write(audio_data)
        temp_file.close()
        logger.info(f"Saved to: {temp_file.name}")
        
        # Step 4: Load audio
        logger.info("Loading audio...")
        y, sr = load_audio(temp_file.name, audio_format)
        
        # Step 5: Resample if needed
        if sr != TARGET_SAMPLE_RATE:
            logger.info(f"Resampling {sr}Hz -> {TARGET_SAMPLE_RATE}Hz")
            y = librosa.resample(y, orig_sr=sr, target_sr=TARGET_SAMPLE_RATE)
            sr = TARGET_SAMPLE_RATE
        
        duration = len(y) / sr
        logger.info(f"Audio ready: {len(y)} samples, {duration:.2f}s")

        # Normalize: guard against raw PCM (int range) slipping through any loader
        peak = float(np.max(np.abs(y)))
        if peak > 1.0:
            logger.info(f"Post-load normalization applied (peak was {peak:.1f})")
            y = y / peak
        
        # Step 6: Extract tap-by-tap analysis for each model
        logger.info("Extracting tap analysis for all three models...")
        
        # Dictionary to store results from each model
        model_results = {
            "internet_sourced": {
                "model_name": "Internet-sourced Model",
                "tap_analysis": None,
                "stage": "unknown",
                "confidence": 0.0,
                "all_predictions": {}
            },
            "own_augmented": {
                "model_name": "Own Dataset (Augmented)",
                "tap_analysis": None,
                "stage": "unknown",
                "confidence": 0.0,
                "all_predictions": {}
            }
        }
        
        # Run predictions for each model
        if acoustic_model is not None:
            try:
                logger.info("Processing Internet-sourced Model...")
                classifier = acoustic_model['classifier'] if isinstance(acoustic_model, dict) else acoustic_model
                tap_analysis_m1 = extract_tap_analysis(y, sr, classifier)
                model_results["internet_sourced"]["tap_analysis"] = tap_analysis_m1
                
                # Compute overall result
                stage_m1, conf_m1, preds_m1 = compute_overall_prediction_from_taps(tap_analysis_m1)
                model_results["internet_sourced"]["stage"] = stage_m1
                model_results["internet_sourced"]["confidence"] = conf_m1
                model_results["internet_sourced"]["all_predictions"] = preds_m1
                logger.info(f"Internet-sourced Model: {stage_m1} ({conf_m1*100:.1f}%)")
            except Exception as e:
                logger.error(f"Internet-sourced model processing failed: {e}", exc_info=True)
        
        if acoustic_model2 is not None:
            try:
                logger.info("Processing Own Dataset (Augmented) Model...")
                classifier = acoustic_model2['classifier'] if isinstance(acoustic_model2, dict) else acoustic_model2
                feature_config = acoustic_model2.get('feature_config') if isinstance(acoustic_model2, dict) else None
                le_m2 = acoustic_model2.get('label_encoder') if isinstance(acoustic_model2, dict) else None
                logger.info(f"Own Dataset label encoder classes: {list(le_m2.classes_) if le_m2 is not None else 'None'}")
                tap_analysis_m2 = extract_tap_analysis(y, sr, classifier, feature_config, label_encoder=le_m2)
                model_results["own_augmented"]["tap_analysis"] = tap_analysis_m2
                
                # Compute overall result
                stage_m2, conf_m2, preds_m2 = compute_overall_prediction_from_taps(tap_analysis_m2)
                model_results["own_augmented"]["stage"] = stage_m2
                model_results["own_augmented"]["confidence"] = conf_m2
                model_results["own_augmented"]["all_predictions"] = preds_m2
                logger.info(f"Own Dataset (Augmented) Model: {stage_m2} ({conf_m2*100:.1f}%)")
            except Exception as e:
                logger.error(f"Augmented model processing failed: {e}", exc_info=True)
        
        # Step 7: Calculate acoustic metrics
        logger.info("Calculating acoustic metrics...")
        metrics = calculate_acoustic_metrics(y, sr)

        # Step 8: Generate stage descriptions
        desc_m1 = generate_stage_description(
            model_results["internet_sourced"]["stage"], metrics,
            model_results["internet_sourced"]["tap_analysis"] or {}
        )
        desc_m2 = generate_stage_description(
            model_results["own_augmented"]["stage"], metrics,
            model_results["own_augmented"]["tap_analysis"] or {}
        )

        logger.info("=" * 40)
        
        return {
            "internet_sourced_model": {
                "model_name": model_results["internet_sourced"]["model_name"],
                "stage": model_results["internet_sourced"]["stage"],
                "confidence": model_results["internet_sourced"]["confidence"],
                "advice": ADVICE.get(model_results["internet_sourced"]["stage"], ""),
                "description": desc_m1,
                "all_predictions": model_results["internet_sourced"]["all_predictions"],
                "tap_analysis": model_results["internet_sourced"]["tap_analysis"]
            },
            "own_dataset_augmented_model": {
                "model_name": model_results["own_augmented"]["model_name"],
                "stage": model_results["own_augmented"]["stage"],
                "confidence": model_results["own_augmented"]["confidence"],
                "advice": ADVICE.get(model_results["own_augmented"]["stage"], ""),
                "description": desc_m2,
                "all_predictions": model_results["own_augmented"]["all_predictions"],
                "tap_analysis": model_results["own_augmented"]["tap_analysis"]
            },
            "metrics": metrics,
            "analysis_summary": {
                "method": "Acoustic classification using THREE different models",
                "features_analyzed": "132,300 raw audio samples at 22050 Hz sample rate (6 seconds)",
                "models_used": [
                    "Internet-sourced acoustic model",
                    "Own dataset with data augmentation"
                ],
                "metrics_measured": ["RMS Energy (dB)", "Dominant Frequency (Hz)", "Spectral Centroid (Hz)", "Zero Crossing Rate"]
            }
        }
        
    except Exception as e:
        import traceback
        logger.error(f"Analysis failed: {e}", exc_info=True)
        logger.error(f"Full traceback: {traceback.format_exc()}")
        raise Exception(f"Audio analysis error: {str(e)}")
    
    finally:
        # Cleanup temp file
        if temp_file and os.path.exists(temp_file.name):
            try:
                os.remove(temp_file.name)
                logger.debug(f"Cleaned up: {temp_file.name}")
            except Exception:
                pass


def compute_overall_prediction_from_taps(tap_analysis: dict) -> tuple:
    """
    Compute overall prediction from individual tap analysis using
    confidence-weighted averaging so more decisive taps contribute more.

    Args:
        tap_analysis: Dictionary with tap1, tap2, tap3 results

    Returns:
        tuple of (stage, confidence, all_predictions_dict)
    """
    all_tap_probs = []
    all_tap_weights = []

    for tap_name in ['tap1', 'tap2', 'tap3']:
        if tap_name in tap_analysis:
            tap_data = tap_analysis[tap_name]
            if tap_data and tap_data.get('stage') != 'unknown':
                tap_probs = tap_data.get('probabilities', {})
                confidence = tap_data.get('confidence', 0.0)
                if tap_probs and confidence > 0:
                    all_tap_probs.append(tap_probs)
                    # Weight = confidence; ensures high-certainty taps dominate
                    all_tap_weights.append(confidence)

    # Ensure we have valid tap data
    if not all_tap_probs:
        logger.warning("No valid tap probabilities found")
        all_predictions = {stage: 1.0 / len(MATURITY_STAGES) for stage in MATURITY_STAGES}
    else:
        total_weight = sum(all_tap_weights)
        all_predictions = {}
        for stage in MATURITY_STAGES:
            weighted_sum = sum(
                all_tap_probs[i].get(stage, 0.0) * all_tap_weights[i]
                for i in range(len(all_tap_probs))
                if isinstance(all_tap_probs[i], dict)
            )
            all_predictions[stage] = float(weighted_sum / total_weight) if total_weight > 0 else 0.0
        logger.info(
            f"Tap weights: { {f'tap{i+1}': round(w, 3) for i, w in enumerate(all_tap_weights)} }"
        )

    # Normalize probabilities to sum to 1
    total_prob = sum(all_predictions.values())
    if total_prob > 0:
        all_predictions = {stage: prob / total_prob for stage, prob in all_predictions.items()}

    # Determine overall stage from weighted probabilities
    probabilities = np.array([all_predictions.get(stage, 0.0) for stage in MATURITY_STAGES])
    stage_idx = int(np.argmax(probabilities))
    stage = MATURITY_STAGES[stage_idx]
    confidence = float(probabilities[stage_idx])

    return stage, confidence, all_predictions
