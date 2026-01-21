import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// 디버깅용 전역 노출
if (typeof window !== 'undefined') {
  (window as any).supabase = supabase
}

// 타입 정의
export type User = {
  id: string
  email: string
  name: string
  role: string
  avatar_url?: string
  status: 'online' | 'away' | 'offline'
  created_at: string
}

export type Message = {
  id: string
  content: string
  sender_id: string
  room_id: string
  created_at: string
  sender?: User
}

export type Post = {
  id: string
  title: string
  content: string
  category: string
  author_id: string
  created_at: string
  author?: User
}

export type Schedule = {
  id: string
  title: string
  description?: string
  date: string
  time: string
  attendees: string[]
  created_by: string
  created_at: string
}

export type ChatRoom = {
  id: string
  name: string
  is_group: boolean
  created_at: string
}
