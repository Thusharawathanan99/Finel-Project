import { User, UserRole } from '../models/User';
import { Heart, Users, Shield } from 'lucide-react';

interface LoginScreenProps {
  onLogin: (user: User) => void;
}

export function LoginScreen({ onLogin }: LoginScreenProps) {
  const sampleUsers = [
    new User('U001', 'Margaret Thompson', 'patient', 'margaret@example.com', 'R001'),
    new User('U002', 'Sarah Johnson', 'caretaker', 'sarah@example.com'),
    new User('U003', 'Admin User', 'admin', 'admin@example.com'),
  ];

  const getRoleIcon = (role: UserRole) => {
    switch (role) {
      case 'patient':
        return <Heart className="w-8 h-8" />;
      case 'caretaker':
        return <Users className="w-8 h-8" />;
      case 'admin':
        return <Shield className="w-8 h-8" />;
    }
  };

  const getRoleColor = (role: UserRole) => {
    switch (role) {
      case 'patient':
        return 'from-teal-200 to-teal-300';
      case 'caretaker':
        return 'from-green-200 to-green-300';
      case 'admin':
        return 'from-purple-200 to-purple-300';
    }
  };

  const getRoleDescription = (role: UserRole) => {
    switch (role) {
      case 'patient':
        return 'View your health, medications, and wellness';
      case 'caretaker':
        return 'Monitor and care for residents';
      case 'admin':
        return 'Supervise and manage the entire system';
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-teal-50 via-purple-50 to-pink-50 flex items-center justify-center p-6">
      <div className="max-w-4xl w-full">
        <div className="text-center mb-12">
          <div className="inline-block p-4 bg-white rounded-2xl shadow-lg mb-4">
            <Heart className="w-16 h-16 text-teal-400" />
          </div>
          <h1 className="text-3xl font-bold text-gray-800 mb-2">
            Smart Healthcare System
          </h1>
          <p className="text-gray-600">Your wellness matters ❤️</p>
        </div>

        <div className="bg-white rounded-2xl shadow-xl p-8">
          <h2 className="text-xl font-semibold text-gray-800 mb-6 text-center">
            Select Your Role to Continue
          </h2>

          <div className="grid md:grid-cols-3 gap-4">
            {sampleUsers.map(user => (
              <button
                key={user.userId}
                onClick={() => onLogin(user)}
                className="group relative overflow-hidden rounded-xl p-6 border-2 border-gray-200 hover:border-teal-300 transition-all hover:shadow-lg bg-gradient-to-br hover:scale-105"
              >
                <div className={`absolute inset-0 bg-gradient-to-br ${getRoleColor(user.role)} opacity-10 group-hover:opacity-20 transition-opacity`} />
                
                <div className="relative">
                  <div className="flex justify-center mb-4">
                    <div className={`p-4 rounded-full bg-gradient-to-br ${getRoleColor(user.role)} text-white`}>
                      {getRoleIcon(user.role)}
                    </div>
                  </div>
                  
                  <h3 className="font-semibold text-gray-800 mb-1 capitalize">
                    {user.role}
                  </h3>
                  <p className="text-sm text-gray-600 mb-3">
                    {user.name}
                  </p>
                  <p className="text-xs text-gray-500">
                    {getRoleDescription(user.role)}
                  </p>
                </div>
              </button>
            ))}
          </div>

          <div className="mt-8 p-4 bg-teal-50 rounded-lg border border-teal-200">
            <p className="text-sm text-teal-900 text-center">
              <span className="font-medium">Demo Mode:</span> Click any role to explore the system
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
