import { EmotionalState } from '../models/EmotionalState';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { TrendingUp, Clock } from 'lucide-react';

interface EmotionalStateChartProps {
  states: EmotionalState[];
}

export function EmotionalStateChart({ states }: EmotionalStateChartProps) {
  if (states.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <TrendingUp className="w-12 h-12 mx-auto mb-2 opacity-50" />
        <p>No emotional state data available</p>
      </div>
    );
  }

  const chronologicalStates = [...states].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const chartData = chronologicalStates
    .map(state => ({
      time: state.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      score: state.stateScore,
      level: state.getEmotionalLevel()
    }));

  const latestState = chronologicalStates[chronologicalStates.length - 1];

  return (
    <div className="space-y-4">
      <div className="bg-gradient-to-r from-teal-50 to-purple-50 rounded-lg p-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-gray-600">Current Emotional State</p>
            <p className="text-2xl font-bold">{latestState.getEmotionalLevel()}</p>
          </div>
          <div className="text-right">
            <p className="text-3xl font-bold text-teal-600">{latestState.stateScore}</p>
            <p className="text-xs text-gray-500">out of 100</p>
          </div>
        </div>
        <div className="flex items-center gap-2 mt-2 text-sm text-gray-600">
          <Clock className="w-3 h-3" />
          <span>Last updated: {latestState.timestamp.toLocaleString()}</span>
        </div>
      </div>

      <div className="bg-white rounded-lg p-4 border">
        <h4 className="font-medium mb-4">Emotional State Trend</h4>
        <ResponsiveContainer width="100%" height={200}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="time" style={{ fontSize: '12px' }} />
            <YAxis domain={[0, 100]} style={{ fontSize: '12px' }} />
            <Tooltip />
            <Line 
              type="monotone" 
              dataKey="score" 
              stroke="#3b82f6" 
              strokeWidth={2}
              dot={{ fill: '#3b82f6', r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-5 gap-2">
        {chronologicalStates.slice(-5).reverse().map((state, idx) => (
          <div key={idx} className="bg-white border rounded p-2 text-center">
            <p className="text-xs text-gray-500 mb-1">
              {state.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </p>
            <p className={`text-lg font-bold ${
              state.stateScore >= 80 ? 'text-green-600' :
              state.stateScore >= 60 ? 'text-teal-600' :
              state.stateScore >= 40 ? 'text-yellow-600' :
              state.stateScore >= 20 ? 'text-orange-600' :
              'text-red-600'
            }`}>
              {state.stateScore}
            </p>
          </div>
        ))}
      </div>
    </div>
  );
}
