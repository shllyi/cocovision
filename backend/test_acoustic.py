import sounddevice as sd
import numpy as np
import time

# ==========================================
# ⚙️ CONFIGURATION (Tweak these if needed)
# ==========================================
SAMPLE_RATE = 44100   # Standard audio quality
DURATION = 0.5        # Speed of listening chunks (0.5s is best)
REPORT_INTERVAL = 10  # How often to show the final result (seconds)
BLOCK_SIZE = int(SAMPLE_RATE * DURATION)

# Thresholds for Coconut Maturity (Hz)
FREQ_MALAUHOG_MIN = 200
FREQ_MALAUHOG_MAX = 800
FREQ_NIYOG_MIN = 800
FREQ_NIYOG_MAX = 2000

# Global variables to store data
detected_frequencies = []
start_time = time.time()

# ==========================================
# 🛠️ STEP 1: MICROPHONE SELECTOR
# ==========================================
def select_microphone():
    print("\n🎧 SCANNING AUDIO DEVICES...")
    print("==========================================")
    print(f"{'ID':<5} | {'DEVICE NAME':<40} | {'CHANNELS'}")
    print("-" * 60)
    
    devices = sd.query_devices()
    input_indices = []

    for i, device in enumerate(devices):
        # We only care about devices with Input Channels (> 0)
        if device['max_input_channels'] > 0:
            input_indices.append(i)
            print(f"{i:<5} | {device['name'][:40]:<40} | {device['max_input_channels']}")

    print("==========================================")
    
    while True:
        try:
            choice = input("\n👉 Enter the ID number of your Microphone: ")
            device_id = int(choice)
            if device_id in input_indices:
                print(f"✅ Selected Device: {devices[device_id]['name']}")
                return device_id
            else:
                print("❌ Invalid ID. Please choose a number from the list above.")
        except ValueError:
            print("❌ Please enter a number.")

# ==========================================
# 🥥 STEP 2: ACOUSTIC ANALYSIS ENGINE
# ==========================================
def print_sound_frequency(indata, frames, time_info, status):
    global start_time, detected_frequencies
    
    if status:
        print(status)
    
    # 1. Convert audio to numbers
    data = indata[:, 0]
    
    # 2. Volume Check (Noise Gate)
    rms = np.sqrt(np.mean(data**2))
    
    # Only analyze if sound is loud enough (The "Tap")
    if rms > 0.02: 
        # Hanning Window helps smooth the math
        windowed_data = data * np.hanning(len(data))
        fft_data = np.fft.rfft(windowed_data) 
        freqs = np.fft.rfftfreq(len(windowed_data), 1.0 / SAMPLE_RATE)
        
        # Find the loudest frequency peak
        peak_idx = np.argmax(np.abs(fft_data))
        peak_freq = freqs[peak_idx]
        
        # Filter valid coconut sounds
        if FREQ_MALAUHOG_MIN < peak_freq < FREQ_NIYOG_MAX:
            detected_frequencies.append(peak_freq)
            print("!", end="", flush=True) # visual feedback
    else:
        print(".", end="", flush=True) # waiting visual

    # 3. Time Check: Report Results every 10 seconds
    if time.time() - start_time > REPORT_INTERVAL:
        print("\n" + "="*45)
        print(f"📊 ANALYSIS REPORT ({REPORT_INTERVAL}s)")
        
        if len(detected_frequencies) > 0:
            avg_freq = int(sum(detected_frequencies) / len(detected_frequencies))
            
            print(f"   🔹 Taps Detected: {len(detected_frequencies)}")
            print(f"   🔹 Avg Frequency: {avg_freq} Hz")
            print("-" * 45)
            
            # THE VERDICT
            if FREQ_MALAUHOG_MIN < avg_freq < FREQ_MALAUHOG_MAX:
                print("   🥥 RESULT: MALAUHOG (Young/Watery)")
                print("   (Sound is dull/low pitched)")
            elif FREQ_NIYOG_MIN <= avg_freq < FREQ_NIYOG_MAX:
                print("   🔔 RESULT: NIYOG (Mature/Hard)")
                print("   (Sound is sharp/high pitched)")
            else:
                print("   ❓ RESULT: INCONCLUSIVE (Try tapping harder)")
        else:
            print("   ❌ No distinct taps detected.")
            
        print("="*45 + "\n")
        
        # Reset for next round
        detected_frequencies = []
        start_time = time.time()
        print("🎤 Starting next round... TAP NOW!")

# ==========================================
# 🚀 MAIN STARTUP
# ==========================================
if __name__ == "__main__":
    # 1. Choose Mic
    mic_id = select_microphone()
    
    # 2. Start Listening
    print("\nStarting Acoustic Engine...")
    print(f"🎤 Listening every {DURATION}s. Reporting every {REPORT_INTERVAL}s.")
    print("Press Ctrl+C to stop.\n")
    
    try:
        with sd.InputStream(device=mic_id,  # <--- Uses your selected mic!
                            callback=print_sound_frequency, 
                            channels=1, 
                            samplerate=SAMPLE_RATE, 
                            blocksize=BLOCK_SIZE): 
            while True:
                pass
    except KeyboardInterrupt:
        print("\n🛑 Stopped.")
    except Exception as e:
        print(f"\n❌ Error: {e}")