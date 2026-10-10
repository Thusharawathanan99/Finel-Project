import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, View } from 'react-native';

const Button = ({ title, onPress, style, textStyle, variant = 'primary', loading = false, disabled = false }) => {
  const isPrimary = variant === 'primary';
  const isDisabled = disabled || loading;
  return (
    <TouchableOpacity accessibilityRole="button" 
      style={[
        styles.button, 
        isPrimary ? styles.primaryButton : styles.secondaryButton, 
        isDisabled && styles.disabledButton,
        style
      ]} 
      onPress={onPress}
      activeOpacity={0.8}
      disabled={isDisabled}
    >
      {loading ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color={isPrimary ? '#FFFFFF' : '#6D38FF'} />
          <Text style={[styles.text, isPrimary ? styles.primaryText : styles.secondaryText, textStyle, { marginLeft: 8 }]}>
            Signing in...
          </Text>
        </View>
      ) : (
        <Text style={[styles.text, isPrimary ? styles.primaryText : styles.secondaryText, textStyle]}>
          {title}
        </Text>
      )}
    </TouchableOpacity>
  );
};

const styles = StyleSheet.create({
  button: {
    minHeight: 56,
    paddingVertical: 16,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    marginVertical: 10,
    width: '100%',
    shadowColor: "#6D38FF",
    shadowOffset: {
      "width": 0,
      "height": 5
    },
    shadowOpacity: 0.18,
    shadowRadius: 20,
    elevation: 3
  },
  primaryButton: {
    backgroundColor: "#6D38FF" // vibrant sky blue
  },
  secondaryButton: {
    backgroundColor: "#EEE9FF",
    borderWidth: 1,
    borderColor: "#E4DFFF"
  },
  text: {
    fontSize: 15,
    fontWeight: "800",
    letterSpacing: 0.1
  },
  primaryText: {
    color: '#FFFFFF'
  },
  secondaryText: {
    color: "#5B32BD"
  },
  disabledButton: {
    opacity: 0.7
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center'
  }
});

export default Button;
