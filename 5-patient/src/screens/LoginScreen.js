import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { auth } from '../firebase/config';
import Button from '../components/Button';
import Input from '../components/Input';
import { API_BASE } from '../apiHelper';

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert("Required Fields", "Please enter your email and password.");
      return;
    }

    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const user = credential.user;
      
      const token = await user.getIdToken();
      
      // We use the configured API_BASE to hit the backend
      const response = await fetch(`${API_BASE}/users/${user.uid}`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      
      let userData;
      
      if (!response.ok) {
        // Fallback for default admin
        if (email.trim().toLowerCase() === 'admin@careconnect.com') {
          await auth.signOut();
          Alert.alert("Access Denied", "This application is restricted to Patients only.");
          return;
        }
        
        // User exists in Firebase but not in MySQL — auto-create a patient profile
        console.log('[Login] User not found in DB, auto-creating patient profile...');
        const residentId = `R-${user.uid.slice(0, 8).toUpperCase()}`;
        
        // Create resident record
        await fetch(`${API_BASE}/residents`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({ residentId, name: user.displayName || email.split('@')[0] }),
        });
        
        // Create user record
        const createRes = await fetch(`${API_BASE}/users`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
          body: JSON.stringify({
            uid: user.uid,
            name: user.displayName || email.split('@')[0],
            email: email.trim().toLowerCase(),
            role: 'patient',
            residentId,
          }),
        });
        
        if (!createRes.ok) {
          throw new Error("Could not create your patient profile. Please try registering instead.");
        }
        userData = { role: 'patient' };
      } else {
        userData = await response.json();
      }
      
      // Strict role enforcement
      if (userData.role !== 'patient') {
        await auth.signOut();
        Alert.alert("Access Denied", "This app is for Patients only. Caretakers and Admins must use the respective portal.");
        return;
      }
      
      navigation.replace('Dashboard');
    } catch (error) {
      console.error("Login error:", error);
      const msg = error?.code === 'auth/invalid-credential'
        ? 'Incorrect email or password. Please check and try again.'
        : error?.code === 'auth/user-not-found'
        ? 'No account found with this email. Please register first.'
        : error?.code === 'auth/too-many-requests'
        ? 'Too many failed attempts. Please try again later.'
        : error?.message || 'An unexpected error occurred.';
      Alert.alert("Login Failed", msg);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        style={styles.keyboardView}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          
          <View style={styles.headerContainer}>
            <View style={styles.logoContainer}>
              <MaterialCommunityIcons name="heart-pulse" size={60} color="#0EA5E9" />
            </View>
            <Text style={styles.brandName}>CareConnect</Text>
            <Text style={styles.subtitle}>Welcome back, Patient.</Text>
          </View>

          <View style={styles.formContainer}>
            <Input 
              label="Email Address" 
              placeholder="patient@example.com" 
              value={email} 
              onChangeText={setEmail} 
            />
            <Input 
              label="Password" 
              placeholder="••••••••" 
              value={password} 
              onChangeText={setPassword} 
              secureTextEntry 
            />
            
            <View style={styles.forgotPasswordContainer}>
              <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
            </View>

            <Button title="Sign In" onPress={handleLogin} style={styles.loginButton} />
          </View>

          <View style={styles.footerContainer}>
            <Text style={styles.footerText}>Don't have an account? </Text>
            <Text style={styles.footerLink} onPress={() => navigation.navigate('Register')}>Sign Up</Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  keyboardView: { flex: 1 },
  scrollContainer: { flexGrow: 1, paddingHorizontal: 24, paddingBottom: 24, justifyContent: 'center' },
  headerContainer: { alignItems: 'center', marginBottom: 40, marginTop: 40 },
  logoContainer: { 
    width: 100, height: 100, borderRadius: 50, backgroundColor: '#F0F9FF', 
    justifyContent: 'center', alignItems: 'center', marginBottom: 16 
  },
  brandName: { fontSize: 32, fontWeight: '800', color: '#1F2937', marginBottom: 8, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: '#6B7280', fontWeight: '500' },
  formContainer: { width: '100%', marginBottom: 24 },
  forgotPasswordContainer: { alignItems: 'flex-end', marginTop: 4, marginBottom: 24 },
  forgotPasswordText: { color: '#0EA5E9', fontWeight: '600', fontSize: 14 },
  loginButton: { marginTop: 8 },
  footerContainer: { flexDirection: 'row', justifyContent: 'center', marginTop: 'auto' },
  footerText: { color: '#6B7280', fontSize: 15 },
  footerLink: { color: '#0EA5E9', fontSize: 15, fontWeight: '700' },
});

export default LoginScreen;
