import CareArtwork from '../components/CareArtwork';
import React, { useState } from 'react';
import { Image, View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, TextInput, TouchableOpacity } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase/config';
import { apiFetch } from '../apiHelper';

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [resettingPassword, setResettingPassword] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);

  const handlePasswordReset = async () => {
    const address = email.trim().toLowerCase();
    if (!address) {
      Alert.alert('Email Required', 'Enter your email address above to receive a password reset link.');
      return;
    }
    if (resettingPassword) return;
    setResettingPassword(true);
    try {
      await sendPasswordResetEmail(auth, address);
      Alert.alert('Check Your Email', 'If an account exists for this email, a password reset link has been sent.');
    } catch (error) {
      Alert.alert('Password Reset Failed', error?.code === 'auth/invalid-email'
        ? 'Please enter a valid email address.'
        : 'We could not send the reset link. Please try again.');
    } finally {
      setResettingPassword(false);
    }
  };

  const handleLogin = async () => {
    if (!email || !password) {
      Alert.alert('Required Fields', 'Please enter your email and password.');
      return;
    }
    if (loading) return;
    setLoading(true);
    let signedInUser = null;
    try {
      const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const user = credential.user;
      signedInUser = user;
      const response = await apiFetch(`/users/${encodeURIComponent(user.uid)}`);
      let userData;
      if (response.status === 404) {
        throw new Error('Your account is not linked to a caretaker profile. Please contact your administrator.');
      } else if (!response.ok) {
        throw new Error('Your account could not be verified. Please try again when the service is available.');
      } else {
        userData = await response.json();
      }
      if (userData.role !== 'caretaker') {
        throw new Error('This app is for Caretakers only. Please use your assigned portal.');
      }
      if (auth.currentUser?.uid !== user.uid) {
        throw new Error('Your session changed. Please sign in again.');
      }
      navigation.replace('Dashboard');
    } catch (error) {
      if (signedInUser && auth.currentUser?.uid === signedInUser.uid) await signOut(auth).catch(() => {});

      const message = error?.code === 'auth/invalid-credential'
        ? 'Incorrect email or password. Please check and try again.'
        : error?.code === 'auth/too-many-requests'
        ? 'Too many failed attempts. Please try again later.'
        : error?.message || 'An unexpected error occurred.';
      Alert.alert('Login Failed', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView 
        style={styles.keyboardView} 
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer}>
          
          <View style={styles.headerContainer}>
            <View style={styles.logoContainer}><MaterialCommunityIcons name="medical-bag" size={23} color="#FFFFFF" /></View>
            <Text style={styles.brandName}>CareConnect</Text>
            <View style={styles.portalPill}><Text style={styles.subtitle}>CARE TEAM</Text></View>
          </View>
          <View style={styles.welcomeHero}>
            <View style={styles.heroCircle} /><View style={styles.heroGlow} />
            <Text style={styles.heroEyebrow}>A LITTLE SUPPORT. A LOT OF CARE.</Text>
            <Text style={styles.heroTitle}>Care starts{'\n'}with connection.</Text>
            <CareArtwork source={require('../../assets/careconnect-characters.png')} style={styles.authImage} resizeMode="contain" />
            <Image source={require('../../assets/careconnect-companion.png')} style={styles.authCompanion} resizeMode="contain" accessible={false} />
            <View style={styles.careSticker}><MaterialCommunityIcons name="heart-outline" size={16} color="#171459" /><Text style={styles.stickerText}>You're in good company</Text></View>
          </View>

          <View style={styles.formContainer}>
            <Text style={styles.formEyebrow}>YOUR CARETAKER PORTAL</Text>
            <Text style={styles.formTitle}>Welcome back.</Text>
            <Text style={styles.formSub}>Sign in and make today a little brighter.</Text>
            <Text style={styles.label}>Caretaker Email</Text>
            <View style={styles.inputWrapper}>
              <MaterialCommunityIcons name="email-outline" size={20} color="#9496AA" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your email"
                placeholderTextColor="#9496AA"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
            </View>

            <Text style={styles.label}>Password</Text>
            <View style={styles.inputWrapper}>
              <MaterialCommunityIcons name="lock-outline" size={20} color="#9496AA" style={styles.inputIcon} />
              <TextInput
                style={styles.input}
                placeholder="Enter your password"
                placeholderTextColor="#9496AA"
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!passwordVisible}
              />
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
                accessibilityState={{ expanded: passwordVisible }}
                style={styles.passwordVisibility}
                onPress={() => setPasswordVisible((visible) => !visible)}
              >
                <MaterialCommunityIcons name={passwordVisible ? 'eye-off-outline' : 'eye-outline'} size={21} color="#615C87" />
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.forgotBtn} onPress={handlePasswordReset} disabled={resettingPassword}>
              <Text style={styles.forgotText}>Forgot Password?</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.loginBtn} onPress={handleLogin} disabled={loading}>
              <MaterialCommunityIcons name="login" size={20} color="#FFFFFF" style={{ marginRight: 8 }} />
              <Text style={styles.loginBtnText}>{loading ? 'Authenticating...' : 'Sign In'}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              accessibilityRole="button"
              accessibilityLabel="Fill Demo Caretaker Credentials"
              style={[styles.loginBtn, { backgroundColor: '#EDE9FE', marginTop: 10, borderWidth: 1, borderColor: '#DDD6FE' }]} 
              onPress={() => {
                setEmail('sarah.caretaker@careconnect.com');
                setPassword('CareConnect@123');
              }}
            >
              <MaterialCommunityIcons name="account-check-outline" size={20} color="#6D38FF" style={{ marginRight: 8 }} />
              <Text style={[styles.loginBtnText, { color: '#6D38FF' }]}>Demo Account: Fill Credentials</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.adminNote}>
            <Image source={require('../../assets/careconnect-care.jpg')} style={styles.noteImage} resizeMode="cover" />
            <MaterialCommunityIcons name="information-outline" size={16} color="#171459" />
            <Text style={styles.adminNoteText}>
              Caretaker accounts are provisioned by system administrators. 
              {'\n'}Demo: sarah.caretaker@careconnect.com (CareConnect@123)
            </Text>
          </View>

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F6F5FF'
  },
  // Light teal background
  keyboardView: {
    flex: 1
  },
  scrollContainer: {
    width: '100%', maxWidth: 520, alignSelf: 'center', flexGrow: 1, paddingHorizontal: 22, paddingBottom: 28, paddingTop: 22,
  },
  headerContainer: {
    flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22,
  },
  logoContainer: {
    width: 42, height: 42, borderRadius: 15, backgroundColor: '#6D38FF', alignItems: 'center', justifyContent: 'center',
  },
  brandName: {
    flex: 1, fontSize: 23, fontWeight: '800', color: '#171459', letterSpacing: -0.8,
  },
  subtitle: {
    fontSize: 9, fontWeight: '800', letterSpacing: 1, color: '#171459',
  },
  formContainer: {
    width: '100%', backgroundColor: '#FFFFFF', padding: 24, borderRadius: 30, borderWidth: 1, borderColor: '#E6E1FB',
    shadowColor: '#171459', shadowOffset: { width: 0, height: 8 }, shadowOpacity: 0.07, shadowRadius: 18, elevation: 3,
  },
  label: {
    fontSize: 12, color: '#171459', marginBottom: 9, fontWeight: '700',
  },
  inputWrapper: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#F6F5FF', borderWidth: 1, borderColor: '#E6E1FB', borderRadius: 17, marginBottom: 18, paddingHorizontal: 15,
  },
  inputIcon: {
    marginRight: 12
  },
  input: {
    flex: 1, height: 54, color: '#171459', fontSize: 14, paddingVertical: 14,
  },
  passwordVisibility: {
    minWidth: 42, minHeight: 42, alignItems: 'center', justifyContent: 'center', marginRight: -6,
  },
  forgotBtn: {
    alignSelf: 'flex-end', marginBottom: 22, paddingVertical: 4,
  },
  forgotText: {
    color: '#6D38FF', fontSize: 12, fontWeight: '700',
  },
  loginBtn: { backgroundColor: '#6D38FF', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 18, borderRadius: 19, shadowColor: '#6D38FF', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.22, shadowRadius: 15, elevation: 3 },
  loginBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700'
  },
  adminNote: {
    flexDirection: 'row', padding: 12, borderRadius: 22, marginTop: 18, alignItems: 'center', backgroundColor: '#EEEBFF', gap: 9,
  },
  adminNoteText: {
    flex: 1, color: '#73758E', fontSize: 10, lineHeight: 16, fontWeight: '500',
  },
  portalPill: { backgroundColor: '#EEEBFF', paddingHorizontal: 10, paddingVertical: 8, borderRadius: 20 },
  welcomeHero: { height: 290, backgroundColor: '#6D38FF', borderRadius: 30, padding: 23, marginBottom: 18, overflow: 'hidden' },
  heroCircle: { position: 'absolute', width: 225, height: 225, borderRadius: 115, backgroundColor: '#8553FF', bottom: -75, right: -30 },
  heroEyebrow: { fontSize: 8, color: '#E2D6FF', fontWeight: '800', letterSpacing: 1.1, zIndex: 2 },
  heroTitle: { fontSize: 29, fontWeight: '800', lineHeight: 33, color: '#FFFFFF', letterSpacing: -1, marginTop: 13, zIndex: 2, maxWidth: 225 },
  authImage: { width: '66%', height: 185, position: 'absolute', right: -8, bottom: -4 },
  careSticker: { position: 'absolute', left: 18, bottom: 15, backgroundColor: '#FFFFFF', paddingHorizontal: 10, paddingVertical: 9, borderRadius: 15, flexDirection: 'row', alignItems: 'center', gap: 6, transform: [{ rotate: '-4deg' }], zIndex: 3 },
  stickerText: { fontSize: 9, fontWeight: '800', color: '#171459' },
  formEyebrow: { fontSize: 8, letterSpacing: 1.2, fontWeight: '800', color: '#6D38FF', marginBottom: 8 },
  formTitle: { fontSize: 27, fontWeight: '800', color: '#171459', letterSpacing: -0.8 },
  formSub: { fontSize: 12, lineHeight: 19, color: '#73758E', marginTop: 7, marginBottom: 25 },
  noteImage: { width: 48, height: 56, borderRadius: 15 },
  heroGlow: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: '#9468FF', top: -90, right: -45, opacity: 0.55 },
  authCompanion: { position: 'absolute', width: 76, height: 83, left: 24, bottom: 54 }
});

export default LoginScreen;
