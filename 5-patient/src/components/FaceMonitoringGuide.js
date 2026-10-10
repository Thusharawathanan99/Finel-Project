import React, { useState } from 'react';
import { View, Text, TouchableOpacity, Image, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { getFaceGuideCopy } from '../../../shared/faceGuide.js';
const art = [
  { key: 'movement', source: require('../../assets/face-guide/facial-movement.png') },
  { key: 'rest', source: require('../../assets/face-guide/rest.png') },
  { key: 'support', source: require('../../assets/face-guide/care-support.png') },
];
// The educational image gallery is never mounted while the live camera runs.
export default function FaceMonitoringGuide({ language }) {
  const [open, setOpen] = useState(false);
  const copy = getFaceGuideCopy(language);
  return <View style={styles.card} testID="face-monitoring-guide"><TouchableOpacity style={styles.heading} accessibilityRole="button" accessibilityState={{ expanded: open }} onPress={() => setOpen(value => !value)}><MaterialCommunityIcons name="book-open-page-variant-outline" size={24} color="#7BCDBC" /><Text style={styles.headingText}>{copy.title}</Text><MaterialCommunityIcons name={open ? 'chevron-up' : 'chevron-down'} size={22} color="#A7C0C6" /></TouchableOpacity>
    {open && <><Text style={styles.notice}>{copy.notice}</Text>{art.map(item => <View key={item.key} style={styles.feature}><Image source={item.source} resizeMode="cover" style={styles.image} accessibilityLabel={copy[item.key]} accessible /><View style={styles.featureCopy}><Text style={styles.title}>{copy[item.key]}</Text><Text style={styles.body}>{copy[item.key + 'Text']}</Text></View></View>)}
      <View style={styles.feature}><View style={styles.diagram} accessible accessibilityLabel={copy.asymmetryText}><View style={styles.face}><View style={[styles.eye,{left:24}]} /><View style={[styles.eye,{right:24}]} /><View style={styles.axis} /><View style={styles.mouth} /><View style={[styles.point,{left:23,top:92}]} /><View style={[styles.point,{right:23,top:82}]} /><View style={[styles.point,{left:48,top:57}]} /></View></View><View style={styles.featureCopy}><Text style={styles.title}>{copy.asymmetry}</Text><Text style={styles.body}>{copy.asymmetryText}</Text></View></View>
    </>}
  </View>;
}
const styles=StyleSheet.create({card:{backgroundColor:'#132A34',borderColor:'#294752',borderWidth:1,borderRadius:24,padding:18,gap:15},heading:{flexDirection:'row',gap:10,alignItems:'center',minHeight:45},headingText:{flex:1,color:'#EDF7F4',fontSize:15,lineHeight:27,fontWeight:'800'},notice:{color:'#9DB6BE',fontSize:11,lineHeight:22},feature:{backgroundColor:'#1D3641',borderRadius:18,overflow:'hidden'},image:{width:'100%',height:170},featureCopy:{padding:16,gap:7},title:{fontSize:16,lineHeight:27,color:'#EEF8F5',fontWeight:'800'},body:{fontSize:12,lineHeight:23,color:'#B4CBD0'},diagram:{height:170,alignItems:'center',justifyContent:'center',backgroundColor:'#E8F5F2'},face:{width:110,height:136,borderRadius:55,borderWidth:2,borderColor:'#426C70',position:'relative'},eye:{position:'absolute',top:42,width:16,height:6,borderBottomWidth:2,borderColor:'#426C70'},axis:{position:'absolute',left:54,top:15,height:106,borderLeftWidth:1,borderColor:'#A0C1BA'},mouth:{position:'absolute',left:25,top:84,width:56,borderBottomWidth:2,borderColor:'#426C70',transform:[{rotate:'-10deg'}]},point:{position:'absolute',width:8,height:8,borderRadius:4,backgroundColor:'#0D9488'}});
