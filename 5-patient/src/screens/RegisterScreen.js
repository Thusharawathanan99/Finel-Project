import React, { useState } from 'react';
import { View, Text, StyleSheet, Alert, KeyboardAvoidingView, Platform, ScrollView } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Picker } from '@react-native-picker/picker';
import { createUserWithEmailAndPassword, updateProfile } from 'firebase/auth';
import { auth } from '../firebase/config';
import Button from '../components/Button';
import Input from '../components/Input';
import { API_BASE } from '../apiHelper';

const RegisterScreen = ({ navigation }) => {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [caretaker, setCaretaker] = useState('');
  const [residentId, setResidentId] = useState('');
  const [caretakerList, setCaretakerList] = useState([]);
  const [loadingCaretakers, setLoadingCaretakers] = useState(true);

  React.useEffect(() => {
    // Fetch caretakers from the Express API (4-system-engine)
    // We use the configured API_BASE to hit the backend
    fetch(`${API_BASE}/caretakers`)
      .then(res => res.json())
      .then(data => {
        setCaretakerList(data);
        setLoadingCaretakers(false);
        // Alert.alert("Debug Fetch", JSON.stringify(data).substring(0, 100));
      })
      .catch(err => {
        console.error('Error fetching caretakers:', err);
        setLoadingCaretakers(false);
      });
  }, []);

  const handleRegister = async () => {
    if (!name || !email || !password || !confirmPassword) {
      Alert.alert("Required Fields", "Please fill out all required fields.");
      return;
    }
    if (password !== confirmPassword) {
      Alert.alert("Password Mismatch", "The passwords you entered do not match.");
      return;
    }
    if (!caretaker) {
      Alert.alert("Required Field", "Please select a Caretaker.");
      return;
    }
    
    try {
      // 1. Create Firebase Auth user
      const credential = await createUserWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
      const user = credential.user;
      
      // 2. Set Firebase Display Name
      await updateProfile(user, { displayName: name.trim() });
      const token = await user.getIdToken();

      // We use the configured API_BASE to hit the backend
      const apiUrl = API_BASE;
      
      // Generate Resident ID if not provided
      const finalResidentId = residentId?.trim() || `R-${user.uid.slice(0, 8).toUpperCase()}`;

      // 3. Create the resident profile first
      const residentRes = await fetch(`${apiUrl}/residents`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ residentId: finalResidentId, name: name.trim() })
      });
      if (!residentRes.ok) throw new Error("Failed to create resident profile.");

      // 4. Upsert User Profile to assign role and link resident
      const userRes = await fetch(`${apiUrl}/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          uid: user.uid,
          name: name.trim(),
          email: email.trim().toLowerCase(),
          role: 'patient',
          residentId: finalResidentId
        })
      });
      if (!userRes.ok) throw new Error("Failed to create user profile.");

      // 5. Assign patient to caretaker
      const assignRes = await fetch(`${apiUrl}/caretakers/${encodeURIComponent(caretaker)}/assign-resident`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ residentId: finalResidentId })
      });
      if (!assignRes.ok) throw new Error("Failed to assign caretaker.");

      // Success!
      navigation.replace('Dashboard');
    } catch (error) {
      console.error("Registration error:", error);
      let msg = error?.message || "An unexpected error occurred.";
      if (error?.code === 'auth/email-already-in-use') {
        msg = 'An account with this email already exists. Please sign in instead.';
      } else if (error?.code === 'auth/weak-password') {
        msg = 'Password is too weak. Please use at least 6 characters.';
      } else if (error?.code === 'auth/invalid-email') {
        msg = 'Please enter a valid email address.';
      }
      Alert.alert("Registration Failed", msg);
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
            <Text style={styles.subtitle}>Patient Register</Text>
          </View>

          <View style={styles.formContainer}>
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

            <View style={styles.pickerContainerWrapper}>
              <Text style={styles.label}>Choose Caretaker</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={caretaker}
                  onValueChange={(itemValue) => setCaretaker(itemValue)}
                  style={styles.picker}
                >
                  {loadingCaretakers && (
                    <Picker.Item label="Loading caretakers..." value="" color="#9CA3AF" />
                  )}
                  {!loadingCaretakers && caretakerList.length === 0 && (
                    <Picker.Item label="No caretakers available" value="" color="#9CA3AF" />
                  )}
                  {!loadingCaretakers && caretakerList.length > 0 && (
                    <Picker.Item label="Select a caretaker" value="" color="#9CA3AF" />
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
              label="Resident ID (optional)" 
              placeholder="mmm" 
              value={residentId} 
              onChangeText={setResidentId} 
            />

            <Button title="Create Patient Account" onPress={handleRegister} style={styles.registerButton} />
          </View>

          <View style={styles.footerContainer}>
            <Text style={styles.footerText}>Already have an account? </Text>
            <Text style={styles.footerLink} onPress={() => navigation.goBack()}>Sign In</Text>
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
  headerContainer: { alignItems: 'center', marginBottom: 24, marginTop: 10 },
  logoContainer: { 
    width: 70, height: 70, borderRadius: 35, backgroundColor: '#F0F9FF', 
    justifyContent: 'center', alignItems: 'center', marginBottom: 12 
  },
  brandName: { fontSize: 26, fontWeight: '800', color: '#1F2937', marginBottom: 4, letterSpacing: -0.5 },
  subtitle: { fontSize: 16, color: '#0EA5E9', fontWeight: '700' },
  formContainer: { width: '100%', marginBottom: 16 },
  label: { fontSize: 14, color: '#4B5563', marginBottom: 6, fontWeight: '600' },
  pickerContainerWrapper: { marginVertical: 10, width: '100%' },
  pickerContainer: {
    borderWidth: 1, borderColor: '#D1D5DB', borderRadius: 12, backgroundColor: '#F9FAFB', overflow: 'hidden',
  },
  picker: { height: 50, width: '100%', color: '#1F2937' },
  registerButton: { marginTop: 16 }, 
  footerContainer: { flexDirection: 'row', justifyContent: 'center', marginTop: 10 },
  footerText: { color: '#6B7280', fontSize: 15 },
  footerLink: { color: '#0EA5E9', fontSize: 15, fontWeight: '700' },
});

export default RegisterScreen;
