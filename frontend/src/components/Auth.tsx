import { useState } from "react";
import { api } from "../api";
import { Heart, Mail, Lock, User, Phone, ArrowRight } from "lucide-react";

interface AuthProps {
  onLogin: (user: any) => void;
}

export default function Auth({ onLogin }: AuthProps) {
  const [isLogin, setIsLogin] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  const [formData, setFormData] = useState({
    email: "",
    password: "",
    name: "",
    age: "",
    phone: ""
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);

    try {
      if (isLogin) {
        const response = await fetch('http://localhost:3001/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password
          })
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Login failed');
        }

        const data = await response.json();
        onLogin(data.user);
      } else {
        const response = await fetch('http://localhost:3001/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: formData.email,
            password: formData.password,
            name: formData.name,
            age: parseInt(formData.age),
            phone: formData.phone
          })
        });

        if (!response.ok) {
          const data = await response.json();
          throw new Error(data.error || 'Registration failed');
        }

        const data = await response.json();
        onLogin(data.user);
      }
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-gradient-to-r from-pink-500 to-purple-600 rounded-full flex items-center justify-center mx-auto mb-4">
              <Heart className="w-10 h-10 text-white fill-current" />
            </div>
            <h1 className="text-3xl font-bold text-gray-900">GlobalConnect</h1>
            <p className="text-gray-500 mt-2">Find your perfect match</p>
          </div>

          <div className="bg-white rounded-2xl shadow-lg p-6">
            <div className="flex mb-6 bg-gray-100 rounded-full p-1">
              <button
                onClick={() => setIsLogin(true)}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                  isLogin ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                Log In
              </button>
              <button
                onClick={() => setIsLogin(false)}
                className={`flex-1 py-2 rounded-full text-sm font-medium transition-colors ${
                  !isLogin ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500'
                }`}
              >
                Sign Up
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {!isLogin && (
                <>
                  <div className="relative">
                    <User className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="text"
                      placeholder="Your name"
                      value={formData.name}
                      onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-pink-500"
                      required
                    />
                  </div>
                  <div className="relative">
                    <Phone className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                    <input
                      type="tel"
                      placeholder="Phone number"
                      value={formData.phone}
                      onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                      className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-pink-500"
                      required
                    />
                  </div>
                  <div className="relative">
                    <input
                      type="number"
                      placeholder="Age"
                      value={formData.age}
                      onChange={(e) => setFormData({ ...formData, age: e.target.value })}
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-pink-500"
                      required
                      min="18"
                      max="100"
                    />
                  </div>
                </>
              )}

              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="email"
                  placeholder="Email"
                  value={formData.email}
                  onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-pink-500"
                  required
                />
              </div>

              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-400" />
                <input
                  type="password"
                  placeholder="Password"
                  value={formData.password}
                  onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                  className="w-full pl-10 pr-4 py-3 border border-gray-200 rounded-xl focus:outline-none focus:border-pink-500"
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <p className="text-red-500 text-sm text-center">{error}</p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-3 bg-pink-500 text-white rounded-xl font-semibold flex items-center justify-center gap-2 hover:bg-pink-600 transition-colors disabled:opacity-50"
              >
                {loading ? 'Loading...' : isLogin ? 'Log In' : 'Sign Up'}
                <ArrowRight className="w-5 h-5" />
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
