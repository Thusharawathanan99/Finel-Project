import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';

const Button = ({ title, onPress, style, loading = false, disabled = false }) => {
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity accessibilityRole="button" style={[styles.button, isDisabled && styles.disabledButton, style]} onPress={onPress} disabled={isDisabled}>
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={[styles.text, { marginLeft: 8 }]}>Signing in...</Text>
        </View>
      ) : (
        <Text style={styles.text}>{title}</Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: { minHeight: 56, backgroundColor: '#6D38FF', padding: 17, borderRadius: 19, alignItems: 'center', justifyContent: 'center', marginVertical: 10, shadowColor: '#6D38FF', shadowOffset: { width: 0, height: 7 }, shadowOpacity: 0.22, shadowRadius: 15, elevation: 3 },
  disabledButton: { opacity: 0.7 },
  loadingRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  text: {
    color: '#FFFFFF', fontSize: 15, fontWeight: '800', letterSpacing: 0.1,
  },
});

export default Button;
