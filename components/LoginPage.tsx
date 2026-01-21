'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'

export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [isElectron, setIsElectron] = useState(false)

  useEffect(() => {
    setIsElectron(!!window.electronAPI?.isElectron)
  }, [])

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError('')

    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    })

    if (error) {
      setError(error.message)
      setLoading(false)
      return
    }

    // 승인 상태 확인
    if (data.user) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('approval_status')
        .eq('id', data.user.id)
        .single()

      if (profile?.approval_status === 'pending') {
        await supabase.auth.signOut()
        setError('가입 승인 대기 중입니다.')
        setLoading(false)
        return
      }

      if (profile?.approval_status === 'rejected') {
        await supabase.auth.signOut()
        setError('가입이 거절되었습니다.')
        setLoading(false)
        return
      }
    }

    setLoading(false)
  }

  const handleClose = () => {
    window.electronAPI?.closeWindow?.()
  }

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow?.()
  }

  return (
    <div className="min-h-screen flex flex-col bg-white">
      {/* 상단 드래그 영역 + 신호등 */}
      <div 
        className="h-10 flex items-center px-3 shrink-0"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        {isElectron && (
          <div 
            className="flex gap-1.5"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            <button onClick={handleClose} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 transition" />
            <button onClick={handleMinimize} className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:brightness-90 transition" />
            <button className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 transition" />
          </div>
        )}
      </div>

      {/* 로그인 폼 */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          {/* 로고 */}
          <div className="text-center mb-8">
            <div className="w-16 h-16 bg-blue-500 rounded-2xl flex items-center justify-center mx-auto mb-4">
              <span className="text-3xl">💬</span>
            </div>
            <h1 className="text-2xl font-bold text-gray-800">Nine Net Messenger</h1>
            <p className="text-gray-500 mt-1">로그인하여 시작하세요</p>
          </div>

          {/* 에러 */}
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-red-600 text-sm">
              {error}
            </div>
          )}

          {/* 폼 */}
          <form onSubmit={handleLogin}>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                이메일
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="email@company.com"
                required
              />
            </div>

            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-1">
                비밀번호
              </label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:border-blue-500"
                placeholder="••••••••"
                required
                minLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full py-3 bg-blue-500 text-white rounded-lg font-medium hover:bg-blue-600 transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? '로그인 중...' : '로그인'}
            </button>
          </form>

          <p className="text-center text-gray-400 text-sm mt-6">
            회원가입은 메인앱에서 진행해주세요
          </p>
        </div>
      </div>
    </div>
  )
}
