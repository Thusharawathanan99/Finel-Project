import CareArtwork from '../components/CareArtwork';
import React from 'react';
import { Image, ScrollView, KeyboardAvoidingView, Platform, View, Text, StyleSheet } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import Button from '../components/Button';

const RegisterScreen = ({ navigation }) => {
  return (
    <SafeAreaView style={styles.safeArea}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.container} keyboardShouldPersistTaps="handled">
          <View style={styles.brand}><View style={styles.mark}><MaterialCommunityIcons name="medical-bag" size={24} color="#FFFFFF" /></View><Text style={styles.brandName}>CareConnect</Text></View>
          <View style={styles.hero}>
            <View style={styles.heroCircle} /><View style={styles.heroGlow} />
            <Text style={styles.eyebrow}>GOOD CARE STARTS HERE</Text>
            <Text style={styles.heroTitle}>Together,{'\n'}we care better.</Text>
            <CareArtwork source={require('../../assets/careconnect-characters.png')} style={styles.heroImage} resizeMode="contain" />
            <Image source={require('../../assets/careconnect-companion.png')} style={styles.authCompanion} resizeMode="contain" accessible={false} />
            <View style={styles.sticker}><MaterialCommunityIcons name="heart-plus-outline" size={16} color="#171459" /><Text style={styles.stickerText}>A place for your care</Text></View>
          </View>
          <View style={styles.form}>
            <Text style={styles.title}>Join your care team</Text>
            <Text style={styles.sub}>Your administrator creates caretaker accounts and assigns residents. Ask them to set up your account, then sign in with the email they registered.</Text>
            <Button title="Back to Login" onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Login')} style={styles.loginButton} />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    padding: 22, paddingBottom: 36, width: '100%', maxWidth: 520, alignSelf: 'center', flexGrow: 1,
  },
  title: {
    fontSize: 27, fontWeight: '800', color: '#171459', letterSpacing: -0.8,
  },
  loginButton: { backgroundColor: '#3478FF', marginTop: 0 },
  safeArea: { flex: 1, backgroundColor: '#F6F5FF' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 22 },
  mark: { width: 43, height: 43, borderRadius: 15, backgroundColor: '#6D38FF', alignItems: 'center', justifyContent: 'center' },
  brandName: { fontSize: 23, fontWeight: '800', color: '#171459', letterSpacing: -0.8 },
  hero: { height: 290, padding: 24, borderRadius: 30, backgroundColor: '#6D38FF', overflow: 'hidden', marginBottom: 18 },
  eyebrow: { fontSize: 8, color: '#E2D6FF', fontWeight: '800', letterSpacing: 1, zIndex: 2 },
  heroTitle: { fontSize: 29, lineHeight: 34, fontWeight: '800', color: '#FFFFFF', letterSpacing: -1, marginTop: 14, zIndex: 2 },
  heroImage: { width: '66%', height: 185, position: 'absolute', bottom: -4, right: -8 },
  sticker: { position: 'absolute', bottom: 15, left: 18, flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 9, borderRadius: 15, backgroundColor: '#FFFFFF', transform: [{ rotate: '-4deg' }], zIndex: 3 },
  stickerText: { fontSize: 9, fontWeight: '800', color: '#171459' },
  form: { backgroundColor: '#FFFFFF', borderRadius: 30, padding: 24, borderWidth: 1, borderColor: '#E6E1FB' },
  sub: { fontSize: 12, color: '#73758E', lineHeight: 19, marginTop: 8, marginBottom: 24 },
  label: { fontSize: 12, color: '#171459', fontWeight: '700', marginTop: 6 },
  heroCircle: { position: 'absolute', width: 225, height: 225, borderRadius: 115, backgroundColor: '#8553FF', bottom: -75, right: -30 },
  heroGlow: { position: 'absolute', width: 210, height: 210, borderRadius: 105, backgroundColor: '#9468FF', top: -90, right: -45, opacity: 0.55 },
  authCompanion: { position: 'absolute', width: 76, height: 83, left: 24, bottom: 54 }
});

export default RegisterScreen;
