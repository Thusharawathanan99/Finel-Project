import React, { useState, useRef } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { createUserWithEmailAndPassword, updateProfile, deleteUser, signOut } from 'firebase/auth';
import { auth } from '../firebase/config';
import Button from '../components/Button';
import Input from '../components/Input';
import CareArtwork from '../components/CareArtwork';
import { getApiBase, apiFetch, clearCache } from '../apiHelper';

const RegisterScreen = ({ navigation }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [caretaker, setCaretaker] = useState('');
  const [residentId, setResidentId] = useState('');
  const [caretakerList, setCaretakerList] = useState([]);
  const [loadingCaretakers, setLoadingCaretakers] = useState(true);
  const [loading, setLoading] = useState(false);
  const submittingRef = useRef(false);

  React.useEffect(() => {
    // Fetch caretakers from the Express API
    fetch(`${getApiBase()}/caretakers`)
      .then(res => {
        if (!res.ok) throw new Error('Caretakers could not be loaded.');
        return res.json();
      })
      .then(data => {
        setCaretakerList(Array.isArray(data) ? data : []);
        setLoadingCaretakers(false);
      })
      .catch(err => {
        console.warn('Error fetching caretakers:', err);
        setCaretakerList([]);
        setLoadingCaretakers(false);
      });
  }, []);

  const handleRegister = async () => {
    if (submittingRef.current) return;
    if (!name.trim() || !email.trim() || !password || !confirmPassword) {
      Alert.alert("Required Fields", "Please fill out all required fields.");
      return;
    }
    if (!caretaker) {
      Alert.alert('Caretaker Required', 'Choose the caretaker responsible for your care before creating your account.');
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Password Mismatch", "The passwords you entered do not match.");
      return;
    }
    const passwordIsStrong = password.length >= 8 && /[a-z]/.test(password) && /[A-Z]/.test(password) && /\d/.test(password);
    if (!passwordIsStrong || residentId.trim().length > 50) {
      Alert.alert('Check Your Details', !passwordIsStrong
        ? 'Use at least 8 characters with uppercase, lowercase, and a number.'
        : 'Resident ID must be at most 50 characters.');
      return;
    }
    let createdUser = null;
    let registrationStarted = false;
    submittingRef.current = true;
    setLoading(true);
    try {
      // 1. Create Firebase Auth user
      const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const user = credential.user;
      createdUser = user;
      
      // 2. Set Firebase Display Name
      await updateProfile(user, { displayName: name.trim() });
      clearCache();
      registrationStarted = true;
      const response = await apiFetch('/users/register-patient', {
        method: 'POST',
        body: JSON.stringify({
          name: name.trim(), email: email.trim().toLowerCase(),
          ...(residentId.trim() ? { residentId: residentId.trim() } : {}),
          caretakerId: caretaker,
        }),
      });
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || 'Failed to create your patient profile. Please try signing in again.');
      }
      const profile = await response.json();
      if (profile.role !== 'patient' || !profile.residentId || auth.currentUser?.uid !== user.uid) {
        throw new Error('Your account setup could not be verified. Please sign in again.');
      }
      navigation.replace('Dashboard');
    } catch (error) {
      console.error("Registration error:", error);
      let accountPreserved = false;
      if (createdUser && auth.currentUser?.uid === createdUser.uid) {
        // Delete only when no server profile was committed; ambiguous failures can be retried at sign in.
        let safeToRollback = !registrationStarted;
        if (registrationStarted) {
          try {
            const profileResponse = await apiFetch(`/users/${encodeURIComponent(createdUser.uid)}`);
            safeToRollback = profileResponse.status === 404;
          } catch { safeToRollback = false; }
        }
        if (safeToRollback) {
          try { await deleteUser(createdUser); } catch { accountPreserved = true; }
        } else { accountPreserved = true; }
        if (auth.currentUser?.uid === createdUser.uid) await signOut(auth).catch(() => {});
        clearCache();
      }
      let msg = error?.message || "An unexpected error occurred.";
      if (error?.code === 'auth/email-already-in-use') {
        msg = 'An account with this email already exists. Please sign in instead.';
      } else if (error?.code === 'auth/weak-password') {
        msg = 'Password is too weak. Use at least 8 characters with uppercase, lowercase, and a number.';
      } else if (error?.code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      }
      if (accountPreserved) msg += ' Your sign-in account was kept. Sign in with this email to verify or complete setup.';
      Alert.alert("Registration Failed", msg);
    } finally {
      submittingRef.current = false;
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
              <Text style={styles.authHeadline}>Make room for{'\n'}better care.</Text>
            </View>
          </View>

          <View style={styles.formContainer}>
            <View style={styles.formHeading}><Text style={styles.formEyebrow}>LET’S GET CONNECTED</Text><MaterialCommunityIcons name="flower-tulip" size={26} color="#FFB85C" /></View>
            <Text style={styles.formTitle}>Patient Register</Text>
            <Text style={styles.formIntro}>A connected space for you and your care team.</Text>
            <Input 
              label="Full Name" 
              placeholder="John Doe" 
              value={name} 
              onChangeText={setName} 
            />
            <Input 
              label="Email" 
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
            <Input 
              label="Confirm Password" 
              placeholder="••••••••" 
              value={confirmPassword} 
              onChangeText={setConfirmPassword} 
              secureTextEntry 
            />
            <Text style={styles.passwordHelp}>Use 8+ characters with uppercase, lowercase, and a number.</Text>

            <View style={styles.pickerContainerWrapper}>
              <Text style={styles.label}>Choose Caretaker</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={caretaker}
                  onValueChange={(itemValue) => setCaretaker(itemValue)}
                  style={styles.picker}
                >
                  {loadingCaretakers && (
                    <Picker.Item label="Loading caretakers..." value="" color="#898AA3" />
                  )}
                  {!loadingCaretakers && caretakerList.length === 0 && (
                    <Picker.Item label="No caretakers available" value="" color="#898AA3" />
                  )}
                  {!loadingCaretakers && caretakerList.length > 0 && (
                    <Picker.Item label="Select a caretaker" value="" color="#898AA3" />
                  )}
                  {!loadingCaretakers && caretakerList.length > 0 && caretakerList.map(c => (
                    <Picker.Item 
                      key={c.caretaker_id || c.id || Math.random().toString()} 
                      label={c.name || c.caretaker_name || 'Unknown Caretaker'} 
                      value={c.caretaker_id || c.id} 
                    />
                  ))}
                </Picker>
              </View>
            </View>

            <Input 
              label="New Resident ID (optional)"
              placeholder="Leave blank to generate an ID"
              value={residentId} 
              onChangeText={setResidentId} 
            />

            <Text style={styles.formIntro}>To link an existing resident record, ask your administrator.</Text>
            <Button title="Create Patient Account" onPress={handleRegister} loading={loading} style={styles.registerButton} />
          </View>

          <View style={styles.footerContainer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Text style={styles.footerLink} onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Login')}>Sign In</Text>
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
    width: 64,
    height: 64,
    borderRadius: 22,
    backgroundColor: "#EEE9FF",
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
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
    fontSize: 26,
    fontWeight: '800',
    color: "#171459",
    marginBottom: 4,
    letterSpacing: -0.5
  },
  subtitle: {
    fontSize: 16,
    color: "#6D38FF",
    fontWeight: '700'
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
  label: {
    fontSize: 12,
    color: "#615C87",
    marginBottom: 8,
    fontWeight: "700"
  },
  passwordHelp: {
    color: '#73708F',
    fontSize: 11,
    lineHeight: 17,
    marginTop: -2,
    marginBottom: 8
  },
  pickerContainerWrapper: {
    marginVertical: 10,
    width: '100%'
  },
  pickerContainer: {
    borderWidth: 1,
    borderColor: "#E4DFFF",
    borderRadius: 16,
    backgroundColor: "#FFFFFF",
    overflow: 'hidden'
  },
  picker: {
    height: 54,
    width: '100%',
    color: "#171459"
  },
  registerButton: {
    marginTop: 16
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
  forgotPasswordText: {
    color: "#6D38FF",
    fontSize: 13
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

export default RegisterScreen;
