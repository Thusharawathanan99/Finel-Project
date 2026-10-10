import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { signInWithEmailAndPassword, signOut, sendPasswordResetEmail } from 'firebase/auth';
import { auth } from '../firebase/config';
import Button from '../components/Button';
import Input from '../components/Input';
import CareArtwork from '../components/CareArtwork';
import { apiFetch, clearCache } from '../apiHelper';

const LoginScreen = ({ navigation }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);

  const [resettingPassword, setResettingPassword] = useState(false);

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
    clearCache();
    let signedInUser = null;
    try {
      const cleanEmail = email.trim().toLowerCase();
      if (cleanEmail === 'admin@careconnect.com') {
        throw new Error('This app is for Patients only. Please use the Admin dashboard.');
      }

      // 1. Authenticate with Firebase
      const credential = await signInWithEmailAndPassword(auth, cleanEmail, password);
      const user = credential.user;
      signedInUser = user;

      // Enter the dashboard only after the server confirms this patient's link.
      const response = await apiFetch(`/users/${encodeURIComponent(user.uid)}`);
      let userData;
      if (response.status === 404) {
        const registration = await apiFetch('/users/register-patient', {
          method: 'POST',
          body: JSON.stringify({ name: user.displayName || cleanEmail.split('@')[0], email: cleanEmail }),
        });
        if (!registration.ok) {
          const errorData = await registration.json().catch(() => ({}));
          throw new Error(errorData.error || 'Your patient profile could not be created. Please try again.');
        }
        const created = await registration.json();
        userData = { role: created.role, resident_id: created.residentId };
      } else if (!response.ok) {
        throw new Error('Your account could not be verified. Please try again when the service is available.');
      } else {
        userData = await response.json();
      }
      if (userData.role !== 'patient') {
        throw new Error('This app is for Patients only. Please use your assigned portal.');
      }
      if (!userData.resident_id) {
        throw new Error('Your account is not linked to a patient profile. Please contact your care team.');
      }
      if (auth.currentUser?.uid !== user.uid) {
        throw new Error('Your session changed. Please sign in again.');
      }
      navigation.replace('Dashboard');
    } catch (error) {
      if (signedInUser && auth.currentUser?.uid === signedInUser.uid) await signOut(auth).catch(() => {});
      clearCache();
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
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <ScrollView contentContainerStyle={styles.scrollContainer} showsVerticalScrollIndicator={false}>
          
          <View style={styles.authBrandRow}>
            <View style={styles.authBrandMark}><MaterialCommunityIcons name="heart-plus" size={23} color="#FFFFFF" /></View>
            <Text style={styles.authBrandText}>CareConnect.</Text>
            <View style={styles.authRolePill}><Text style={styles.authRoleText}>PATIENT</Text></View>
          </View>
          <View style={styles.headerContainer}>
            <View pointerEvents="none" style={styles.authGlow} />
            <View style={styles.authOrb} />
            <View style={styles.authSticker}><Image source={require('../../assets/careconnect-companion.png')} style={styles.authCompanion} resizeMode="contain" accessible={false} /></View>
            <CareArtwork style={styles.authArtwork} />
            <View style={styles.authHeroCopy}>
              <Text style={styles.authEyebrow}>A LITTLE CONNECTION. A LOT OF CARE.</Text>
              <Text style={styles.authHeadline}>Your care,{'\n'}in good company.</Text>
            </View>
          </View>

          <View style={styles.formContainer}>
            <View style={styles.formHeading}><Text style={styles.formEyebrow}>WELCOME HOME</Text><MaterialCommunityIcons name="flower-tulip" size={26} color="#FFB85C" /></View>
            <Text style={styles.formTitle}>Welcome back, Patient.</Text>
            <Text style={styles.formIntro}>Your everyday care starts here.</Text>
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
              <Text style={styles.forgotPasswordText} accessibilityRole="button" onPress={handlePasswordReset}>{resettingPassword ? 'Sending reset link...' : 'Forgot Password?'}</Text>
            </View>

            <Button title="Sign In" onPress={handleLogin} loading={loading} style={styles.loginButton} />
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
  safeArea: {
    flex: 1,
    backgroundColor: "#F6F5FF"
  },
  keyboardView: {
    flex: 1
  },
  scrollContainer: {
    width: '100%',
    maxWidth: 560,
    alignSelf: 'center',
    flexGrow: 1,
    paddingHorizontal: 20,
    paddingBottom: 36,
    justifyContent: "flex-start",
    paddingTop: 20
  },
  headerContainer: {
    alignItems: "stretch",
    marginBottom: 18,
    marginTop: 24,
    minHeight: 282,
    backgroundColor: "#6D38FF",
    borderRadius: 32,
    overflow: "hidden",
    position: "relative"
  },
  logoContainer: {
    width: 84,
    height: 84,
    borderRadius: 28,
    backgroundColor: "#EEE9FF",
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    shadowColor: "#6D38FF",
    shadowOffset: {
      "width": 0,
      "height": 6
    },
    shadowOpacity: 0.1,
    shadowRadius: 14,
    elevation: 2
  },
  brandName: {
    fontSize: 32,
    fontWeight: '800',
    color: "#171459",
    marginBottom: 8,
    letterSpacing: -0.5
  },
  subtitle: {
    fontSize: 16,
    color: "#73708F",
    fontWeight: '500'
  },
  formContainer: {
    borderWidth: 1,
    borderColor: "#EAE4FF",
    width: '100%',
    marginBottom: 20,
    backgroundColor: '#FFFFFF',
    padding: 24,
    borderRadius: 30,
    shadowColor: "#6D38FF",
    shadowOffset: {
      "width": 0,
      "height": 8
    },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3
  },
  forgotPasswordContainer: {
    alignItems: 'flex-end',
    marginTop: 4,
    marginBottom: 24
  },
  forgotPasswordText: {
    color: "#6D38FF",
    fontWeight: '600',
    fontSize: 13
  },
  loginButton: {
    marginTop: 8
  },
  footerContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    marginTop: 2,
    flexWrap: "wrap",
    rowGap: 6
  },
  footerText: {
    color: "#73708F",
    fontSize: 13
  },
  footerLink: {
    color: "#6D38FF",
    fontSize: 13,
    fontWeight: '700'
  },
  authBrandRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 9
  },
  authBrandMark: {
    width: 36,
    height: 36,
    borderRadius: 12,
    backgroundColor: "#6D38FF",
    alignItems: "center",
    justifyContent: "center",
    transform: [{
      "rotate": "-8deg"
    }]
  },
  authBrandText: {
    fontSize: 21,
    fontWeight: "800",
    letterSpacing: -0.8,
    color: "#171459",
    flex: 1
  },
  authRolePill: {
    backgroundColor: "#FFFFFF",
    borderRadius: 20,
    paddingHorizontal: 11,
    paddingVertical: 8
  },
  authRoleText: {
    color: "#615C87",
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1.5
  },
  authOrb: {
    position: "absolute",
    width: 230,
    height: 230,
    right: -50,
    top: -56,
    borderRadius: 115,
    backgroundColor: "#A078FF"
  },
  authArtwork: {
    width: 230,
    height: 220,
    position: "absolute",
    top: 5,
    right: -9
  },
  authSticker: {
    width: 66,
    height: 66,
    borderRadius: 23,
    backgroundColor: "#FFFFFF24",
    alignItems: "center",
    justifyContent: "center",
    position: "absolute",
    top: 28,
    left: 23,
    transform: [{
      "rotate": "-8deg"
    }]
  },
  authHeroCopy: {
    padding: 25,
    paddingTop: 226,
    position: "relative"
  },
  authEyebrow: {
    fontSize: 8,
    letterSpacing: 1.3,
    color: "#F4EBFF",
    fontWeight: "800",
    marginBottom: 10
  },
  authHeadline: {
    fontSize: 31,
    lineHeight: 36,
    fontWeight: "800",
    letterSpacing: -1.1,
    color: "#FFFFFF"
  },
  formHeading: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 6
  },
  formEyebrow: {
    fontSize: 9,
    letterSpacing: 1.7,
    color: "#6D38FF",
    fontWeight: "800"
  },
  formTitle: {
    fontSize: 23,
    lineHeight: 31,
    color: "#171459",
    letterSpacing: -0.6,
    fontWeight: "800",
    marginBottom: 6
  },
  formIntro: {
    fontSize: 13,
    lineHeight: 19,
    color: "#73708F",
    marginBottom: 15
  },
  label: {
    color: "#615C87",
    fontSize: 12,
    fontWeight: "700",
    marginBottom: 8
  },
  pickerContainer: {
    borderColor: "#E4DFFF",
    backgroundColor: "#FFFFFF",
    borderRadius: 16
  },
  picker: {
    color: "#171459",
    height: 54
  },
  authGlow: {
    position: "absolute",
    left: -80,
    top: -90,
    width: 250,
    height: 250,
    borderRadius: 125,
    backgroundColor: "#3478FF",
    opacity: 0.84
  },
  authCompanion: {
    width: 76,
    height: 76
  }
});

export default LoginScreen;
