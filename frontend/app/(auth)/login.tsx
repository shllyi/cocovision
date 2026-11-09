import React, { useState, useEffect } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, KeyboardAvoidingView, Platform, ActivityIndicator, Image, Alert } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import * as SecureStore from 'expo-secure-store';
import { NGROK_URL } from '../../constants/config';

// --- GOOGLE AUTH IMPORTS ---
import * as WebBrowser from 'expo-web-browser';
import * as Google from 'expo-auth-session/providers/google';
import { GoogleAuthProvider, signInWithCredential } from 'firebase/auth';
import { auth } from '../../constants/firebase'; 
import axios from 'axios';

// Required for WebBrowser to work correctly
WebBrowser.maybeCompleteAuthSession();

export default function LoginScreen() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isLoginAttempting, setIsLoginAttempting] = useState(false);
  const isWeb = Platform.OS === 'web';

  // --- 1. SETUP GOOGLE AUTH REQUEST ---
  // Determine redirect URL based on environment


const [request, response, promptAsync] = Google.useIdTokenAuthRequest({
  clientId: '355795447724-7a9p21hk4gbnd2r77roq64e5hg9rjqft.apps.googleusercontent.com',
  androidClientId: '355795447724-k5qeg9fa2mj3guoc6fv8i9i759cjv6lb.apps.googleusercontent.com',

});

  // --- 2. HANDLE GOOGLE RESPONSE ---
  useEffect(() => {
    if (response?.type === 'success' && !isLoginAttempting) {
      const { id_token } = response.params;
      setIsLoginAttempting(true);
      handleGoogleSignIn(id_token);
    } else if (response?.type === 'error') {
      console.error("Google Auth Error:", response.error);
      setError("Google Sign-In failed to start.");
      setIsLoginAttempting(false);
    }
  }, [response]);

  const handleGoogleSignIn = async (idToken: string) => {
    setLoading(true);
    setError('');
    try {
      // A. Sign in to Firebase with the Google Token
      const credential = GoogleAuthProvider.credential(idToken);
      const userCredential = await signInWithCredential(auth, credential);
      
      // B. Get the Firebase ID Token (JWT)
      const firebaseToken = await userCredential.user.getIdToken();

      // C. Send to YOUR Backend
      const res = await axios.post(`${NGROK_URL}/auth/google-login`, {
        token: firebaseToken
      });

      if (res.data.status === 'success') {
        await saveSession(res.data.user);
        router.replace('/(tabs)');
      } else {
        setError(res.data.detail || 'Google login failed on server.');
      }
    } catch (err: any) {
      console.error("Google Sign-In Error:", err);
      // Extract error message from various sources
      let errorMessage = 'Google Sign-In failed';
      
      if (err.code === 'auth/popup-closed-by-user') {
        errorMessage = "Sign-in cancelled.";
      } else if (err.response?.data?.detail) {
        errorMessage = err.response.data.detail;
      } else if (err.response?.data && Array.isArray(err.response.data)) {
        // Handle Pydantic validation errors
        errorMessage = err.response.data.map((e: any) => e.msg).join(', ');
      } else if (typeof err.message === 'string') {
        errorMessage = err.message;
      }
      
      setError(errorMessage);
    } finally {
      setLoading(false);
      setIsLoginAttempting(false);
    }
  };

  // --- 3. STANDARD EMAIL LOGIN ---
  const handleLogin = async () => {
    if(!email || !password) {
      setError("Please fill in all fields");
      return;
    }

    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${NGROK_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'ngrok-skip-browser-warning': 'true' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      if (response.ok && data.status === 'success') {
        await saveSession(data.user);
        router.replace('/(tabs)');
      } else {
        // Handle various error response formats
        let errorMsg = 'Login failed';
        
        if (typeof data.detail === 'string') {
          errorMsg = data.detail;
        } else if (Array.isArray(data.detail)) {
          // Handle Pydantic validation errors
          errorMsg = data.detail.map((e: any) => {
            if (typeof e === 'string') return e;
            if (typeof e.msg === 'string') return e.msg;
            return 'Invalid input';
          }).join(', ');
        }
        
        setError(errorMsg);
      }
    } catch (error: any) {
      let errorMsg = 'An error occurred during login';
      if (typeof error.message === 'string') {
        errorMsg = error.message;
      }
      setError(errorMsg);
      console.error('Login error:', error);
    } finally {
      setLoading(false);
    }
  };

  // Helper to save session safely on Web/Mobile
  const saveSession = async (user: any) => {
    const userString = JSON.stringify(user);
    if (Platform.OS === 'web') {
      localStorage.setItem('user_session', userString);
    } else {
      await SecureStore.setItemAsync('user_session', userString);
    }
  };



  return (
    <KeyboardAvoidingView 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'} 
      style={styles.container}
    >

      {/* Top Left Brand Title */}
      <View style={[styles.topLeftHeader, isWeb && styles.topLeftHeaderWeb]}>
        <Ionicons name="leaf" size={isWeb ? 24 : 20} color="#16a34a" style={styles.brandIcon} />
        <Text style={[styles.brandTitle, isWeb && styles.brandTitleWeb]}>CocoVision</Text>
      </View>

      {/* Go Back Button - Navigation to Home */}
      <TouchableOpacity style={[styles.goBackButton, isWeb && styles.goBackButtonWeb]} onPress={() => router.canGoBack() ? router.back() : router.replace('/(tabs)')}>
        <Ionicons name="arrow-back" size={isWeb ? 20 : 18} color="#16a34a" />
      </TouchableOpacity>

      {/* Main Content Wrapper */}
      <View style={[styles.mainWrapper, isWeb && styles.mainWrapperWeb]}>

        {/* Left Side - Login Form Panel */}
        <View style={[styles.formPanel, isWeb && styles.formPanelWeb]}>

          {/* Form Inner Container */}
          <View style={[styles.innerContainer, isWeb && styles.innerContainerWeb]}>

            {/* Welcome Icon */}
            <View style={[styles.welcomeIcon, isWeb && styles.welcomeIconWeb]}>
              <Ionicons name="leaf" size={isWeb ? 32 : 28} color="#16a34a" />
            </View>

            {/* Page Title and Subtitle */}
            <Text style={[styles.title, isWeb && styles.titleWeb]}>Welcome back</Text>
            <Text style={[styles.subtitle, isWeb && styles.subtitleWeb]}>Please enter your details.</Text>

            {/* Error Message Display */}
            {error ? (
              error.toLowerCase().includes('deactivated') ? (
                <View style={styles.deactivatedBanner}>
                  <View style={styles.deactivatedBannerHeader}>
                    <Ionicons name="ban" size={20} color="#b91c1c" />
                    <Text style={styles.deactivatedBannerTitle}>Account Deactivated</Text>
                  </View>
                  <Text style={styles.deactivatedBannerBody}>
                    {error.replace('Your account has been deactivated. Reason:', '').trim()
                      ? `Reason: ${error.replace('Your account has been deactivated. Reason:', '').trim()}`
                      : error}
                  </Text>
                  <Text style={styles.deactivatedBannerContact}>Please contact support if you believe this is a mistake.</Text>
                </View>
              ) : (
                <Text style={styles.errorText}>{error}</Text>
              )
            ) : null}

            {/* Email Input Field */}
            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.input, isWeb && styles.inputWeb]}
                  placeholder="Email"
                  placeholderTextColor="#9ca3af"
                  value={email}
                  onChangeText={setEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                />
                <Ionicons name="mail-outline" size={20} color="#9ca3af" style={styles.inputIcon} />
              </View>
            </View>

            {/* Password Input Field */}
            <View style={styles.inputGroup}>
              <View style={styles.inputWrapper}>
                <TextInput
                  style={[styles.input, isWeb && styles.inputWeb]}
                  placeholder="Password"
                  placeholderTextColor="#9ca3af"
                  value={password}
                  onChangeText={setPassword}
                  secureTextEntry
                />
                <Ionicons name="eye-outline" size={20} color="#9ca3af" style={styles.inputIcon} />
              </View>
            </View>

            {/* Login Submit Button */}
            <TouchableOpacity 
              style={[styles.button, isWeb && styles.buttonWeb, loading && { opacity: 0.7 }]} 
              onPress={handleLogin}
              disabled={loading}
            >
              {loading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.buttonText}>Login</Text>
              )}
            </TouchableOpacity>

            {/* Divider and Google Sign-In Button (Web Only) */}
            {isWeb && (
              <>
                <View style={styles.dividerContainer}>
                  <View style={styles.dividerLine} />
                  <Text style={styles.dividerText}>or continue with</Text>
                  <View style={styles.dividerLine} />
                </View>

                <TouchableOpacity 
                  style={[styles.googleButton, styles.googleButtonWeb]} 
                  onPress={() => promptAsync()}
                  disabled={!request || loading}
                >
                  <Ionicons name="logo-google" size={20} color="#DB4437" style={{ marginRight: 10 }} />
                  <Text style={styles.googleButtonText}>Sign in with Google</Text>
                </TouchableOpacity>
              </>
            )}

            {/* Footer - Sign Up Link */}
            <View style={styles.footer}>
              <Text style={styles.footerText}>Don't have an account? </Text>
              <TouchableOpacity onPress={() => router.push('/(auth)/register')}>
                <Text style={styles.linkText}>Sign up</Text>
              </TouchableOpacity>
            </View>

          </View>
        </View>

        {/* Right Side - Image Panel (Web Only) */}
        {isWeb && (
          <View style={styles.imagePanel}>
            <Image 
              source={require('../../assets/images/slide3.png')} 
              style={styles.panelImage}
              resizeMode="cover"
            />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  mainWrapper: { flex: 1 },
  mainWrapperWeb: { flexDirection: 'row', flex: 1, backgroundColor: '#fff' },
  
  formPanel: { flex: 1, backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 30 },
  formPanelWeb: { backgroundColor: '#fff', justifyContent: 'center', alignItems: 'center', paddingHorizontal: 80, paddingVertical: 40, paddingLeft: 100 },
  
  topLeftHeader: { position: 'absolute', top: 50, left: 20, zIndex: 10, flexDirection: 'row', alignItems: 'center' },
  topLeftHeaderWeb: { top: 30, left: 30 },
  goBackButton: { position: 'absolute', top: 50, right: 20, zIndex: 10, flexDirection: 'row', alignItems: 'center' },
  goBackButtonWeb: { top: 30, right: 30 },
  
  brandIcon: { marginRight: 8 },
  brandTitle: { fontSize: 20, fontWeight: '700', color: '#16a34a' },
  brandTitleWeb: { fontSize: 24 },
  
  innerContainer: { justifyContent: 'center', width: '100%', maxWidth: 350 },
  innerContainerWeb: { flex: 0, paddingHorizontal: 0, maxWidth: 450 },
  
  welcomeIcon: { marginBottom: 20, width: 56, height: 56, borderRadius: 28, borderWidth: 2, borderColor: '#16a34a', justifyContent: 'center', alignItems: 'center' },
  welcomeIconWeb: { width: 64, height: 64, borderRadius: 32 },
  
  title: { fontSize: 28, fontWeight: 'bold', color: '#1e293b', textAlign: 'left', marginBottom: 8 },
  titleWeb: { fontSize: 42 },
  subtitle: { fontSize: 14, color: '#6b7280', textAlign: 'left', marginBottom: 32 },
  subtitleWeb: { fontSize: 18, marginBottom: 40 },
  
  inputGroup: { marginBottom: 16 },
  inputWrapper: { position: 'relative' },
  input: { height: 48, backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 16, paddingRight: 44, borderWidth: 1, borderColor: '#e2e8f0', fontSize: 15, color: '#1e293b' },
  inputWeb: { height: 58, fontSize: 17, borderRadius: 10 },
  inputIcon: { position: 'absolute', right: 16, top: 18 },
  
  button: { backgroundColor: '#16a34a', height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginTop: 8 },
  buttonWeb: { marginTop: 20, height: 58, borderRadius: 29 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },

  // Google Button Styles
  googleButton: { flexDirection: 'row', backgroundColor: '#fff', height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center', marginTop: 16, borderWidth: 1, borderColor: '#e2e8f0' },
  googleButtonWeb: { height: 58, borderRadius: 29 },
  googleButtonText: { color: '#374151', fontSize: 16, fontWeight: '600' },
  
  dividerContainer: { flexDirection: 'row', alignItems: 'center', marginVertical: 20 },
  dividerLine: { flex: 1, height: 1, backgroundColor: '#e2e8f0' },
  dividerText: { marginHorizontal: 10, color: '#9ca3af', fontSize: 14 },
  
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24 },
  footerText: { color: '#6b7280', fontSize: 14 },
  linkText: { color: '#16a34a', fontSize: 14, fontWeight: '600' },
  errorText: { color: '#ef4444', textAlign: 'center', marginBottom: 15 },

  deactivatedBanner: {
    backgroundColor: '#fef2f2',
    borderWidth: 1,
    borderColor: '#fecaca',
    borderRadius: 10,
    padding: 14,
    marginBottom: 16,
  },
  deactivatedBannerHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 6,
  },
  deactivatedBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#b91c1c',
  },
  deactivatedBannerBody: {
    fontSize: 13,
    color: '#7f1d1d',
    lineHeight: 18,
    marginBottom: 6,
  },
  deactivatedBannerContact: {
    fontSize: 12,
    color: '#ef4444',
    fontStyle: 'italic',
  },

  imagePanel: { flex: 1, margin: 16, borderRadius: 24, overflow: 'hidden' },
  panelImage: { width: '100%', height: '100%' }
});