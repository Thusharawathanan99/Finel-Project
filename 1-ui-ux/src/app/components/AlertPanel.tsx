import { Alert } from '../models/Alert';
import { AlertCircle, CheckCircle, Info, AlertTriangle } from 'lucide-react';

interface AlertPanelProps {
  alerts: Alert[];
  onAcknowledge: (alertId: string) => void;
}

export function AlertPanel({ alerts, onAcknowledge }: AlertPanelProps) {
  const getAlertIcon = (severity: string) => {
    switch (severity) {
      case 'critical':
        return <AlertCircle className="w-5 h-5" />;
      case 'high':
        return <AlertTriangle className="w-5 h-5" />;
      case 'medium':
        return <Info className="w-5 h-5" />;
      case 'low':
        return <CheckCircle className="w-5 h-5" />;
      default:
        return <Info className="w-5 h-5" />;
    }
  };

  const getAlertStyle = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-50 border-red-300 text-red-900';
      case 'high':
        return 'bg-orange-50 border-orange-300 text-orange-900';
      case 'medium':
        return 'bg-yellow-50 border-yellow-300 text-yellow-900';
      case 'low':
        return 'bg-teal-50 border-teal-300 text-teal-900';
      default:
        return 'bg-gray-50 border-gray-300 text-gray-900';
    }
  };

  const activeAlerts = alerts.filter(a => !a.acknowledged);
  const acknowledgedAlerts = alerts.filter(a => a.acknowledged);

  if (alerts.length === 0) {
    return (
      <div className="text-center py-8 text-gray-500">
        <CheckCircle className="w-12 h-12 mx-auto mb-2 opacity-50 text-green-500" />
        <p>No alerts at this time</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {activeAlerts.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm text-gray-700">Active Alerts ({activeAlerts.length})</h4>
          {activeAlerts.map(alert => (
            <div
              key={alert.alertId}
              className={`border-2 rounded-lg p-4 ${getAlertStyle(alert.severityLevel)}`}
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  {getAlertIcon(alert.severityLevel)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 rounded text-xs font-medium bg-white/50">
                      {alert.severityLevel.toUpperCase()}
                    </span>
                    <span className="text-xs opacity-75">
                      {alert.timestamp.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm">{alert.message}</p>
                </div>
                <button
                  onClick={() => onAcknowledge(alert.alertId)}
                  className="px-3 py-1 rounded bg-white hover:bg-gray-50 text-sm border transition-colors"
                >
                  Acknowledge
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {acknowledgedAlerts.length > 0 && (
        <div className="space-y-2">
          <h4 className="font-medium text-sm text-gray-700">Acknowledged ({acknowledgedAlerts.length})</h4>
          {acknowledgedAlerts.map(alert => (
            <div
              key={alert.alertId}
              className="border rounded-lg p-3 bg-gray-50 opacity-60"
            >
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5 text-gray-500">
                  <CheckCircle className="w-4 h-4" />
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs opacity-75">
                      {alert.timestamp.toLocaleString()}
                    </span>
                  </div>
                  <p className="text-sm text-gray-700">{alert.message}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
