import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { sevenDayWellness, wellnessStyle } from '../careSummary';
export default function WellnessTrend({ records = [] }) {
  const [width,setWidth]=useState(0),points=sevenDayWellness(records);
  const step=width/6;
  return <View style={{padding:16,borderRadius:18,backgroundColor:'white',marginVertical:12}}>
    <Text style={{fontSize:18,fontWeight:'700',color:'#171459'}}>7-day wellness trend</Text>
    <Text style={{fontSize:12,color:'#64748B',marginVertical:8}}>Daily average of recorded observations. Missing days remain blank.</Text>
    <View onLayout={event=>setWidth(Math.max(0,event.nativeEvent.layout.width))} style={{height:115,marginHorizontal:16,marginTop:10}}>
      {points.slice(1).map((point,index)=>{
        const previous=points[index];if(previous.score==null||point.score==null)return null;
        const x=step/2+index*step,y=90-(previous.score+point.score)*0.45,delta=(previous.score-point.score)*0.9,length=Math.sqrt(step*step+delta*delta);
        return <View key={'line'+index} style={{position:'absolute',left:x-length/2,top:y,width:length,height:2,backgroundColor:'#6D38FF',transform:[{rotate:Math.atan2(delta,step)+'rad'}]}}/>;
      })}
      {points.map((point,index)=><View key={point.day} style={{position:'absolute',left:index*step-20,top:point.score==null?90:90-point.score*0.9,width:40,alignItems:'center'}}><View style={{width:8,height:8,borderRadius:4,backgroundColor:point.score==null?'#CBD5E1':wellnessStyle(point.score).color}}/><Text accessibilityLabel={point.day+': '+(point.score??'Not recorded')} style={{fontSize:10}}>{point.score??'—'}</Text></View>)}
    </View><View style={{flexDirection:'row',justifyContent:'space-between'}}>{points.map(point=><Text key={point.day} style={{fontSize:10,color:'#64748B'}}>{point.day.slice(5)}</Text>)}</View>
  </View>;
}

