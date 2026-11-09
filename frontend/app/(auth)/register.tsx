import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, ScrollView, KeyboardAvoidingView, Platform, ActivityIndicator, Alert, Image } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { NGROK_URL } from '../../constants/config';

export default function RegisterScreen() {
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    phoneNumber: '',
    location: '',
    password: '',
    confirmPassword: '',
  });

  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const isWeb = Platform.OS === 'web';

  const handleRegister = async () => {
    // Basic Client-side validation
    if (formData.password !== formData.confirmPassword) {
      setErrorMessage("Passwords do not match.");
      return;
    }

    setLoading(true);
    setErrorMessage('');

    try {
      const response = await fetch(`${NGROK_URL}/auth/register`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'ngrok-skip-browser-warning': 'true' // Bypass ngrok warning page
        },
        body: JSON.stringify(formData),
      });

      const data = await response.json();

      if (response.ok) {
        if (Platform.OS === 'web') {
          window.alert("Account created successfully! Redirecting to login...");
          router.replace('/(auth)/login');
        } else {
          Alert.alert("Success", "Account created successfully! Redirecting to login...", [
            { text: "OK", onPress: () => router.replace('/(auth)/login') }
          ]);
        }
      } else {
        // Displays the 'detail' from your FastAPI HTTPException
        setErrorMessage(data.detail || "Registration failed. Please check your inputs.");
      }
    } catch (error) {
      setErrorMessage("Network error: Make sure your backend and Ngrok are running.");
    } finally {
      setLoading(false);
    }
  };

  const updateField = (field: string, value: string) => {
    setFormData({ ...formData, [field]: value });
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

      {/* Go Back Button */}
      <TouchableOpacity style={[styles.goBackButton, isWeb && styles.goBackButtonWeb]} onPress={() => router.back()}>
        <Ionicons name="arrow-back" size={isWeb ? 20 : 18} color="#16a34a" />
      </TouchableOpacity>

      {/* Main Content Wrapper */}
      <View style={[styles.mainWrapper, isWeb && styles.mainWrapperWeb]}>

        {/* Left Side - Register Form Panel */}
        <View style={[styles.formPanel, isWeb && styles.formPanelWeb]}>
          <ScrollView 
            showsVerticalScrollIndicator={false} 
            contentContainerStyle={[styles.scrollContent, isWeb && styles.scrollContentWeb]}
          >
            {/* Form Inner Container */}
            <View style={[styles.innerContainer, isWeb && styles.innerContainerWeb]}>

              {/* Welcome Icon */}
              <View style={[styles.welcomeIcon, isWeb && styles.welcomeIconWeb]}>
                <Ionicons name="person-add" size={isWeb ? 32 : 28} color="#16a34a" />
              </View>

              {/* Page Title and Subtitle */}
              <Text style={[styles.title, isWeb && styles.titleWeb]}>Create Account</Text>
              
              {/* Error or Subtitle Display */}
              {errorMessage ? (
                <View style={styles.errorContainer}>
                  <Ionicons name="alert-circle" size={18} color="#ef4444" />
                  <Text style={styles.errorText}>{errorMessage}</Text>
                </View>
              ) : (
                <Text style={[styles.subtitle, isWeb && styles.subtitleWeb]}>Fill in your details to join CocoVision</Text>
              )}

              {/* Full Name Input */}
              <View style={styles.inputGroup}>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, isWeb && styles.inputWeb]}
                    placeholder="Full Name"
                    placeholderTextColor="#9ca3af"
                    onChangeText={(v) => updateField('fullName', v)}
                    value={formData.fullName}
                  />
                  <Ionicons name="person-outline" size={20} color="#9ca3af" style={styles.inputIcon} />
                </View>
              </View>

              {/* Email Input */}
              <View style={styles.inputGroup}>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, isWeb && styles.inputWeb]}
                    placeholder="Email Address"
                    placeholderTextColor="#9ca3af"
                    keyboardType="email-address"
                    autoCapitalize="none"
                    onChangeText={(v) => updateField('email', v)}
                    value={formData.email}
                  />
                  <Ionicons name="mail-outline" size={20} color="#9ca3af" style={styles.inputIcon} />
                </View>
              </View>

              {/* Phone Number Input */}
              <View style={styles.inputGroup}>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, isWeb && styles.inputWeb]}
                    placeholder="Phone Number"
                    placeholderTextColor="#9ca3af"
                    keyboardType="phone-pad"
                    onChangeText={(v) => updateField('phoneNumber', v)}
                    value={formData.phoneNumber}
                  />
                  <Ionicons name="call-outline" size={20} color="#9ca3af" style={styles.inputIcon} />
                </View>
              </View>

              {/* Location Input */}
              <View style={styles.inputGroup}>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, isWeb && styles.inputWeb]}
                    placeholder="Farm Address / Location"
                    placeholderTextColor="#9ca3af"
                    onChangeText={(v) => updateField('location', v)}
                    value={formData.location}
                  />
                  <Ionicons name="location-outline" size={20} color="#9ca3af" style={styles.inputIcon} />
                </View>
              </View>

              {/* Password Input */}
              <View style={styles.inputGroup}>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, isWeb && styles.inputWeb]}
                    placeholder="Password (min. 8 characters)"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry
                    onChangeText={(v) => updateField('password', v)}
                    value={formData.password}
                  />
                  <Ionicons name="lock-closed-outline" size={20} color="#9ca3af" style={styles.inputIcon} />
                </View>
              </View>

              {/* Confirm Password Input */}
              <View style={styles.inputGroup}>
                <View style={styles.inputWrapper}>
                  <TextInput
                    style={[styles.input, isWeb && styles.inputWeb]}
                    placeholder="Confirm Password"
                    placeholderTextColor="#9ca3af"
                    secureTextEntry
                    onChangeText={(v) => updateField('confirmPassword', v)}
                    value={formData.confirmPassword}
                  />
                  <Ionicons name="shield-checkmark-outline" size={20} color="#9ca3af" style={styles.inputIcon} />
                </View>
              </View>

              {/* Register Button */}
              <TouchableOpacity 
                style={[styles.button, isWeb && styles.buttonWeb, loading && { opacity: 0.7 }]} 
                onPress={handleRegister}
                disabled={loading}
              >
                {loading ? (
                  <ActivityIndicator color="#fff" />
                ) : (
                  <Text style={styles.buttonText}>Create Account</Text>
                )}
              </TouchableOpacity>

              {/* Footer - Sign In Link */}
              <View style={styles.footer}>
                <Text style={styles.footerText}>Already have an account? </Text>
                <TouchableOpacity onPress={() => router.push('/(auth)/login')}>
                  <Text style={styles.linkText}>Sign In</Text>
                </TouchableOpacity>
              </View>

            </View>
          </ScrollView>
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
  
  formPanel: { flex: 1, backgroundColor: '#fff' },
  formPanelWeb: { backgroundColor: '#fff', paddingHorizontal: 80, paddingVertical: 40, paddingLeft: 100 },
  
  scrollContent: { paddingHorizontal: 30, paddingBottom: 40, paddingTop: 100 },
  scrollContentWeb: { paddingHorizontal: 0, paddingTop: 80, justifyContent: 'center', flexGrow: 1 },
  
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
  titleWeb: { fontSize: 38 },
  subtitle: { fontSize: 14, color: '#6b7280', textAlign: 'left', marginBottom: 24 },
  subtitleWeb: { fontSize: 16, marginBottom: 32 },
  
  errorContainer: { 
    flexDirection: 'row', 
    alignItems: 'center', 
    backgroundColor: '#fef2f2', 
    padding: 12, 
    borderRadius: 10, 
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#fecaca' 
  },
  errorText: { color: '#ef4444', fontSize: 14, fontWeight: '500', marginLeft: 8, flex: 1 },
  
  inputGroup: { marginBottom: 14 },
  inputWrapper: { position: 'relative' },
  input: { height: 48, backgroundColor: '#fff', borderRadius: 10, paddingHorizontal: 16, paddingRight: 44, borderWidth: 1, borderColor: '#e2e8f0', fontSize: 15, color: '#1e293b' },
  inputWeb: { height: 54, fontSize: 16, borderRadius: 12 },
  inputIcon: { position: 'absolute', right: 16, top: 14 },
  
  button: { backgroundColor: '#16a34a', height: 50, borderRadius: 25, justifyContent: 'center', alignItems: 'center', marginTop: 16 },
  buttonWeb: { marginTop: 24, height: 56, borderRadius: 28 },
  buttonText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  
  footer: { flexDirection: 'row', justifyContent: 'center', marginTop: 24, paddingBottom: 20 },
  footerText: { color: '#6b7280', fontSize: 14 },
  linkText: { color: '#16a34a', fontSize: 14, fontWeight: '600' },

  imagePanel: { flex: 1, margin: 16, borderRadius: 24, overflow: 'hidden' },
  panelImage: { width: '100%', height: '100%' }
});