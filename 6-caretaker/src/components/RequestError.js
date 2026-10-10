import React from 'react';
import {View,Text,TouchableOpacity} from 'react-native';
export default function RequestError({message,onRetry}) {
  if (!message) return null;
  return <View accessibilityRole="alert" style={{backgroundColor:'#FEF2F2',borderColor:'#FECACA',borderWidth:1,borderRadius:14,padding:14,margin:12}}><Text style={{color:'#991B1B',lineHeight:20}}>{message}</Text><TouchableOpacity accessibilityRole="button" onPress={onRetry} style={{paddingVertical:10}}><Text style={{color:'#991B1B',fontWeight:'700'}}>Try again</Text></TouchableOpacity></View>;
}
