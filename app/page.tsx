'use client'

import { useState, useEffect } from 'react'
import { supabase } from '@/lib/supabase'
import LoginPage from '@/components/LoginPage'

interface ChatRoom {
  id: string
  name: string
  is_group: boolean
  is_self?: boolean
  created_at: string
  created_by?: string
  last_message?: string
  last_message_time?: string
  unread_count?: number
  display_name?: string
  is_pinned?: boolean
}

interface Member {
  id: string
  name: string
  email: string
  is_online?: boolean
  last_seen?: string
  role?: string
  avatar_url?: string
  phone?: string
  department?: string
  position?: string
  status_message?: string
}

type TabType = 'members' | 'chats' | 'settings'

interface ContextMenu {
  show: boolean
  x: number
  y: number
  roomId: string
  isSelf: boolean
}

interface ChatSettings {
  bgColor: string
  fontFamily: string
  fontSize: number
  fontWeight: string
  notificationEnabled: boolean
  autoLogin: boolean
}

const DEFAULT_SETTINGS: ChatSettings = {
  bgColor: '#666666',
  fontFamily: 'system',
  fontSize: 14,
  fontWeight: 'normal',
  notificationEnabled: true,
  autoLogin: false,
}

const FONT_OPTIONS = [
  { value: 'system', label: '시스템 기본' },
  { value: 'Pretendard', label: 'Pretendard' },
  { value: 'NanumGothic', label: '나눔고딕' },
  { value: 'NotoSansKR', label: '노토산스' },
]

const BG_COLOR_PRESETS = [
  // Row 1 - 파스텔/밝은
  '#b8d4e8', '#6b8cae', '#a8d5ba', '#5fb3a1', '#a4c56a',
  // Row 2 - 비비드
  '#f5c842', '#e8956a', '#e57373', '#f8a5c2', '#4a3c3c',
  // Row 3 - 중성/모던  
  '#c8c8c8', '#555555', '#3d4a6b', '#1e3a4c', '#8b9cad',
  // Row 4 - 딥
  '#2d6e6e', '#5a6e4a', '#a66b7a', '#7a5c4f', '#3d5a80',
  // Row 5
  '#6b5b8c',
]

export default function MessengerMain() {
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<Member | null>(null)
  const [rooms, setRooms] = useState<ChatRoom[]>([])
  const [members, setMembers] = useState<Member[]>([])
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabType>('members')
  const [isElectron, setIsElectron] = useState(false)
  const [contextMenu, setContextMenu] = useState<ContextMenu>({ show: false, x: 0, y: 0, roomId: '', isSelf: false })
  const [pinnedRooms, setPinnedRooms] = useState<string[]>([])
  const [settings, setSettings] = useState<ChatSettings>(DEFAULT_SETTINGS)

  // 설정 로드
  useEffect(() => {
    try {
      const savedSettings = localStorage.getItem('chatSettings')
      if (savedSettings) {
        const parsed = { ...DEFAULT_SETTINGS, ...JSON.parse(savedSettings) }
        setSettings(parsed)
      }
    } catch (e) {
      console.error('Failed to load settings:', e)
    }
  }, [])

  // 설정 저장 (자동)
  const saveSettings = (newSettings: Partial<ChatSettings>) => {
    setSettings(prev => {
      const updated = { ...prev, ...newSettings }
      localStorage.setItem('chatSettings', JSON.stringify(updated))
      return updated
    })
  }

  useEffect(() => { 
    checkAuth()
    setIsElectron(!!window.electronAPI?.isElectron)
    
    const handleClick = () => setContextMenu(prev => ({ ...prev, show: false }))
    window.addEventListener('click', handleClick)
    
    // 로그인 상태 변경 감지
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (event === 'SIGNED_IN' && session?.user) {
        setUser(session.user)
      } else if (event === 'SIGNED_OUT') {
        setUser(null)
      }
    })
    
    return () => {
      window.removeEventListener('click', handleClick)
      subscription.unsubscribe()
    }
  }, [])
  
  useEffect(() => { 
    if (user) { 
      fetchProfile()
      fetchRooms()
      fetchMembers()
      
      // 온라인 상태 설정
      updateOnlineStatus(true)
      
      // 브라우저/앱 종료 시 오프라인 처리
      const handleBeforeUnload = () => {
        updateOnlineStatus(false)
      }
      window.addEventListener('beforeunload', handleBeforeUnload)
      
      // Presence 구독 (실시간 온라인 상태)
      const presenceChannel = supabase.channel('online-users')
        .on('presence', { event: 'sync' }, () => {
          fetchMembers()
        })
        .subscribe(async (status) => {
          if (status === 'SUBSCRIBED') {
            await presenceChannel.track({ user_id: user.id, online_at: new Date().toISOString() })
          }
        })
      
      const channel = supabase.channel('messenger-updates')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'messages',
          },
          () => {
            fetchRooms()
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'room_members',
          },
          () => {
            fetchRooms()
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'profiles',
          },
          () => {
            fetchMembers()
          }
        )
        .subscribe()
      
      return () => {
        handleBeforeUnload()
        window.removeEventListener('beforeunload', handleBeforeUnload)
        supabase.removeChannel(channel)
        supabase.removeChannel(presenceChannel)
      }
    }
  }, [user])

  const updateOnlineStatus = async (isOnline: boolean) => {
    if (!user) return
    try {
      await supabase.from('profiles').update({ 
        is_online: isOnline,
        last_seen: new Date().toISOString()
      }).eq('id', user.id)
    } catch (e) {
      // is_online 컬럼이 없으면 무시
      console.log('Online status update skipped:', e)
    }
  }

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) { setUser(session.user) }
    setLoading(false)
  }

  const fetchProfile = async () => {
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (data) setProfile(data)
  }

  const fetchRooms = async () => {
    // 나와의 채팅방 확인
    const { data: existingSelfRooms } = await supabase
      .from('chat_rooms')
      .select('id')
      .eq('is_self', true)
      .eq('created_by', user.id)

    // 없으면 생성
    if (!existingSelfRooms || existingSelfRooms.length === 0) {
      const { data: newSelfRoom } = await supabase
        .from('chat_rooms')
        .insert({ name: '나와의 채팅', is_group: false, is_self: true, created_by: user.id })
        .select()
        .single()
      
      if (newSelfRoom) {
        await supabase.from('room_members').insert({ room_id: newSelfRoom.id, user_id: user.id })
      }
    }

    // 내가 참여중인 모든 채팅방
    const { data: myMemberships } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', user.id)

    if (!myMemberships || myMemberships.length === 0) {
      setRooms([])
      return
    }

    const roomIds = myMemberships.map(m => m.room_id)

    const { data: allRooms } = await supabase
      .from('chat_rooms')
      .select('*')
      .in('id', roomIds)
      .order('created_at', { ascending: false })

    if (allRooms) {
      const roomsWithMessages = await Promise.all(
        allRooms.map(async (room) => {
          // 최신 메시지
          const { data: lastMsgs } = await supabase
            .from('messages')
            .select('content, created_at, content_type')
            .eq('room_id', room.id)
            .order('created_at', { ascending: false })
            .limit(1)
          
          const lastMsg = lastMsgs && lastMsgs.length > 0 ? lastMsgs[0] : null

          // 안 읽은 메시지 수 (나와의 채팅은 제외)
          let unreadCount = 0
          if (!room.is_self) {
            const { data: unreadMsgs } = await supabase
              .from('messages')
              .select('id, read_by')
              .eq('room_id', room.id)
              .neq('sender_id', user.id)

            if (unreadMsgs) {
              unreadCount = unreadMsgs.filter(msg => {
                const readBy = msg.read_by || []
                return !readBy.includes(user.id)
              }).length
            }
          }

          // 표시 이름 결정
          let displayName = room.name
          
          if (room.is_self) {
            displayName = '나와의 채팅'
          } else if (!room.is_group) {
            // 1:1 채팅 - 상대방 이름만
            const { data: roomMembersList } = await supabase
              .from('room_members')
              .select('user_id')
              .eq('room_id', room.id)
            
            if (roomMembersList) {
              const otherUserId = roomMembersList.find(m => m.user_id !== user.id)?.user_id
              if (otherUserId) {
                const { data: otherUser } = await supabase
                  .from('profiles')
                  .select('name, email')
                  .eq('id', otherUserId)
                  .single()
                
                if (otherUser) {
                  displayName = otherUser.name || otherUser.email?.split('@')[0] || room.name
                }
              }
            }
          }

          return {
            ...room,
            last_message: lastMsg ? (lastMsg.content_type === 'file' ? '📎 파일' : lastMsg.content_type === 'system' ? lastMsg.content : lastMsg.content) : '',
            last_message_time: lastMsg?.created_at || room.created_at,
            unread_count: unreadCount,
            display_name: displayName,
            is_pinned: pinnedRooms.includes(room.id),
          }
        })
      )

      // 정렬
      const sortedRooms = roomsWithMessages.sort((a, b) => {
        if (a.is_self) return -1
        if (b.is_self) return 1
        if (a.is_pinned && !b.is_pinned) return -1
        if (!a.is_pinned && b.is_pinned) return 1
        return new Date(b.last_message_time || 0).getTime() - new Date(a.last_message_time || 0).getTime()
      })

      setRooms(sortedRooms)
    }
  }

  const fetchMembers = async () => {
    const { data } = await supabase.from('profiles').select('*').neq('id', user.id)
    if (data) setMembers(data)
  }

  const openChatWindow = (room: ChatRoom, preOpenedWindow?: Window | null) => {
    const roomName = room.is_self ? '나와의 채팅' : (room.display_name || room.name)
    if (window.electronAPI?.isElectron) {
      window.electronAPI.openChat(room.id, roomName)
    } else if (preOpenedWindow) {
      // 이미 열린 창에 URL 설정
      preOpenedWindow.location.href = `/chat/${room.id}`
    } else {
      // 웹: 새 창으로 채팅 열기 (Electron과 동일 사이즈)
      const width = 400
      const height = 550
      const left = window.screen.width - width - 40
      const top = 120
      window.open(
        `/chat/${room.id}`,
        `chat_${room.id}`,
        `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
      )
    }
  }

  // 웹용: 미리 창 열기
  const preOpenChatWindow = () => {
    if (window.electronAPI?.isElectron) return null
    const width = 400
    const height = 550
    const left = window.screen.width - width - 40
    const top = 120
    return window.open(
      'about:blank',
      `chat_${Date.now()}`,
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=no`
    )
  }

  const openSelfChat = async () => {
    let selfRoom = rooms.find(r => r.is_self)
    
    // 없으면 생성
    if (!selfRoom) {
      const { data: newRoom } = await supabase
        .from('chat_rooms')
        .insert({ name: '나와의 채팅', is_group: false, is_self: true, created_by: user.id })
        .select()
        .single()
      
      if (newRoom) {
        await supabase.from('room_members').insert({ room_id: newRoom.id, user_id: user.id })
        selfRoom = { ...newRoom, display_name: '나와의 채팅' }
        fetchRooms() // 목록 새로고침
      }
    }
    
    if (selfRoom) openChatWindow(selfRoom)
  }

  const startDirectChat = async (member: Member) => {
    // 웹: 팝업 차단 방지를 위해 미리 창 열기
    const preOpened = preOpenChatWindow()
    
    // 1. 내가 참여 중인 1:1 채팅방에서 상대방도 있는지 확인
    const { data: myMemberships } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', user.id)

    if (myMemberships) {
      for (const membership of myMemberships) {
        const { data: room } = await supabase
          .from('chat_rooms')
          .select('*')
          .eq('id', membership.room_id)
          .eq('is_group', false)
          .eq('is_self', false)
          .single()

        if (room) {
          const { data: memberCheck } = await supabase
            .from('room_members')
            .select('user_id')
            .eq('room_id', room.id)
            .eq('user_id', member.id)

          if (memberCheck && memberCheck.length > 0) {
            // 둘 다 있는 기존 방 열기
            openChatWindow({ ...room, display_name: member.name || member.email?.split('@')[0] }, preOpened)
            return
          }
        }
      }
    }

    // 2. 상대방이 참여 중인 1:1 채팅방에서 나와의 기존 방 찾기 (내가 나갔던 방)
    const { data: theirMemberships } = await supabase
      .from('room_members')
      .select('room_id')
      .eq('user_id', member.id)

    if (theirMemberships) {
      for (const membership of theirMemberships) {
        const { data: room } = await supabase
          .from('chat_rooms')
          .select('*')
          .eq('id', membership.room_id)
          .eq('is_group', false)
          .eq('is_self', false)
          .single()

        if (room) {
          // 이 방의 멤버 확인
          const { data: allRoomMembers } = await supabase
            .from('room_members')
            .select('user_id')
            .eq('room_id', room.id)

          // 상대방만 있는 1:1 방이면 나를 다시 추가
          if (allRoomMembers && allRoomMembers.length === 1 && allRoomMembers[0].user_id === member.id) {
            await supabase.from('room_members').insert({
              room_id: room.id,
              user_id: user.id,
            })
            await fetchRooms()
            openChatWindow({ ...room, display_name: member.name || member.email?.split('@')[0] }, preOpened)
            return
          }
        }
      }
    }

    // 3. 완전히 새 채팅방 생성
    const { data: newRoom } = await supabase
      .from('chat_rooms')
      .insert({ name: `${member.name || member.email?.split('@')[0]}`, is_group: false })
      .select()
      .single()
    
    if (newRoom) {
      await supabase.from('room_members').insert([
        { room_id: newRoom.id, user_id: user.id },
        { room_id: newRoom.id, user_id: member.id },
      ])
      await fetchRooms()
      openChatWindow({ ...newRoom, display_name: member.name || member.email?.split('@')[0] }, preOpened)
    } else {
      // 실패 시 미리 연 창 닫기
      preOpened?.close()
    }
  }

  const createGroupChat = async () => {
    const groupName = prompt('그룹 채팅방 이름을 입력하세요:')
    if (!groupName) return
    
    const { data: newRoom } = await supabase
      .from('chat_rooms')
      .insert({ name: groupName, is_group: true, created_by: user.id })
      .select()
      .single()
    
    if (newRoom) {
      await supabase.from('room_members').insert({ room_id: newRoom.id, user_id: user.id })
      await fetchRooms()
      openChatWindow(newRoom)
    }
  }

  const handleContextMenu = (e: React.MouseEvent, room: ChatRoom) => {
    e.preventDefault()
    setContextMenu({
      show: true,
      x: e.clientX,
      y: e.clientY,
      roomId: room.id,
      isSelf: room.is_self || false,
    })
  }

  const handleOpenRoom = () => {
    const room = rooms.find(r => r.id === contextMenu.roomId)
    if (room) openChatWindow(room)
    setContextMenu(prev => ({ ...prev, show: false }))
  }

  const handlePinRoom = () => {
    const roomId = contextMenu.roomId
    if (pinnedRooms.includes(roomId)) {
      setPinnedRooms(prev => prev.filter(id => id !== roomId))
    } else {
      setPinnedRooms(prev => [...prev, roomId])
    }
    setContextMenu(prev => ({ ...prev, show: false }))
    setTimeout(() => fetchRooms(), 100)
  }

  const handleLeaveRoom = async () => {
    const roomId = contextMenu.roomId
    
    if (contextMenu.isSelf) {
      alert('나와의 채팅은 나갈 수 없습니다.')
      setContextMenu(prev => ({ ...prev, show: false }))
      return
    }
    
    if (!confirm('채팅방을 나가시겠습니까?')) {
      setContextMenu(prev => ({ ...prev, show: false }))
      return
    }
    
    // 시스템 메시지 먼저 추가
    await supabase.from('messages').insert({
      content: `${profile?.name || user.email?.split('@')[0]}님이 나갔습니다.`,
      content_type: 'system',
      sender_id: user.id,
      room_id: roomId,
      read_by: [],
    })
    
    // 딜레이
    await new Promise(resolve => setTimeout(resolve, 300))
    
    // room_members에서 삭제
    const { error } = await supabase
      .from('room_members')
      .delete()
      .eq('room_id', roomId)
      .eq('user_id', user.id)
    
    if (error) {
      alert('채팅방 나가기에 실패했습니다: ' + error.message)
      setContextMenu(prev => ({ ...prev, show: false }))
      return
    }
    
    // 리스트에서 제거
    setRooms(prev => prev.filter(r => r.id !== roomId))
    setContextMenu(prev => ({ ...prev, show: false }))
  }

  const handleLogout = async () => {
    if (!confirm('로그아웃 하시겠습니까?')) return
    await updateOnlineStatus(false)
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  const handleClose = () => {
    window.electronAPI?.closeWindow?.()
  }

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow?.()
  }

  const StatusDot = ({ isOnline }: { isOnline?: boolean }) => {
    return (
      <span className={`inline-block w-2.5 h-2.5 rounded-full ${isOnline ? 'bg-green-500' : 'bg-gray-400'}`}></span>
    )
  }

  const formatTime = (dateString?: string) => {
    if (!dateString) return ''
    const date = new Date(dateString)
    const now = new Date()
    const diff = now.getTime() - date.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    
    if (days === 0) return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
    if (days === 1) return '어제'
    if (days < 7) return `${days}일 전`
    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-gray-50">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-500"></div>
      </div>
    )
  }

  if (!user) {
    return <LoginPage />
  }

  return (
    <div className="h-screen flex bg-white overflow-hidden">
      {/* 사이드바 - 카카오톡 스타일 */}
      <div 
        className="w-[70px] bg-gray-100 flex flex-col items-center py-2 flex-shrink-0"
        style={{ WebkitAppRegion: 'drag' } as any}
      >
        {/* 신호등 버튼 (가로 배열) */}
        {isElectron && (
          <div 
            className="flex gap-1.5 mb-4 mt-1"
            style={{ WebkitAppRegion: 'no-drag' } as any}
          >
            <button onClick={handleClose} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 transition" />
            <button onClick={handleMinimize} className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:brightness-90 transition" />
            <button className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 transition" />
          </div>
        )}
        
        <div style={{ WebkitAppRegion: 'no-drag' } as any} className="flex flex-col items-center w-full">
          <button
            onClick={() => setActiveTab('members')}
            className={`w-12 h-12 rounded-xl flex items-center justify-center mb-1 transition ${
              activeTab === 'members' ? 'bg-white shadow text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </button>
          
          <button
            onClick={() => setActiveTab('chats')}
            className={`w-12 h-12 rounded-xl flex items-center justify-center mb-1 transition ${
              activeTab === 'chats' ? 'bg-white shadow text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <svg className="w-6 h-6" fill="currentColor" viewBox="0 0 24 24">
              <path d="M20 2H4c-1.1 0-2 .9-2 2v18l4-4h14c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm0 14H5.17L4 17.17V4h16v12z"/>
            </svg>
          </button>
        </div>
        
        <div className="flex-1" style={{ WebkitAppRegion: 'drag' } as any} />
        
        <div style={{ WebkitAppRegion: 'no-drag' } as any}>
          <button
            onClick={() => setActiveTab('settings')}
            className={`w-12 h-12 rounded-xl flex items-center justify-center mb-2 transition ${
              activeTab === 'settings' ? 'bg-white shadow text-gray-900' : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.324.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.24-.438.613-.431.992a6.759 6.759 0 010 .255c-.007.378.138.75.43.99l1.005.828c.424.35.534.954.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.57 6.57 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.28c-.09.543-.56.941-1.11.941h-2.594c-.55 0-1.02-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.992a6.932 6.932 0 010-.255c.007-.378-.138-.75-.43-.99l-1.004-.828a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.087.22-.128.332-.183.582-.495.644-.869l.214-1.281z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* 메인 영역 */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* 헤더 */}
        <div 
          className="px-4 py-3 border-b border-gray-100 flex items-center justify-between flex-shrink-0"
          style={{ WebkitAppRegion: 'drag' } as any}
        >
          <h1 className="text-base font-semibold text-gray-800">
            {activeTab === 'chats' ? '채팅' : activeTab === 'members' ? '멤버' : '설정'}
          </h1>
          {activeTab === 'chats' && (
            <button 
              onClick={createGroupChat} 
              className="text-gray-400 hover:text-gray-600 p-1"
              style={{ WebkitAppRegion: 'no-drag' } as any}
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            </button>
          )}
        </div>

        {/* 컨텐츠 */}
        <div className="flex-1 overflow-y-auto min-w-0">
          {/* 멤버 리스트 */}
          {activeTab === 'members' && (
            <div>
              {/* 나 - 클릭하면 나와의 채팅 */}
              <div 
                className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
                onClick={openSelfChat}
              >
                <div className="relative flex-shrink-0">
                  {profile?.avatar_url ? (
                    <img src={profile.avatar_url} alt="프로필" className="w-11 h-11 rounded-full object-cover" />
                  ) : (
                    <div className="w-11 h-11 bg-blue-100 rounded-full flex items-center justify-center text-lg">👤</div>
                  )}
                  <div className="absolute -bottom-0.5 -right-0.5 p-0.5 bg-white rounded-full">
                    <StatusDot isOnline={true} />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-sm font-medium text-gray-800 truncate">{profile?.name || user.email?.split('@')[0]}</p>
                    {profile?.position && <span className="text-xs text-gray-400">· {profile.position}</span>}
                  </div>
                  {profile?.status_message ? (
                    <p className="text-xs text-blue-500 truncate">📝 {profile.status_message}</p>
                  ) : (
                    <p className="text-xs text-gray-400 truncate">나와의 채팅</p>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100 my-1" />

              {members.length === 0 ? (
                <p className="text-center text-gray-400 text-xs py-8">다른 멤버가 없습니다</p>
              ) : (
                members.map(member => (
                  <div
                    key={member.id}
                    className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
                    onClick={() => startDirectChat(member)}
                  >
                    <div className="relative flex-shrink-0">
                      {member.avatar_url ? (
                        <img src={member.avatar_url} alt="프로필" className="w-11 h-11 rounded-full object-cover" />
                      ) : (
                        <div className="w-11 h-11 bg-gray-200 rounded-full flex items-center justify-center text-lg">👤</div>
                      )}
                      <div className="absolute -bottom-0.5 -right-0.5 p-0.5 bg-white rounded-full">
                        <StatusDot isOnline={member.is_online} />
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="text-sm font-medium text-gray-800 truncate">{member.name || member.email?.split('@')[0]}</p>
                        {member.position && <span className="text-xs text-gray-400">· {member.position}</span>}
                      </div>
                      {member.status_message ? (
                        <p className="text-xs text-blue-500 truncate">📝 {member.status_message}</p>
                      ) : (
                        <p className="text-xs text-gray-400 truncate">
                          {member.is_online ? '온라인' : member.last_seen ? `마지막 접속: ${formatTime(member.last_seen)}` : '오프라인'}
                        </p>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 채팅방 리스트 */}
          {activeTab === 'chats' && (
            <div>
              {rooms.length === 0 ? (
                <p className="text-center text-gray-400 text-xs py-8">채팅방이 없습니다</p>
              ) : (
                rooms.map(room => (
                  <div
                    key={room.id}
                    onClick={() => openChatWindow(room)}
                    onContextMenu={(e) => handleContextMenu(e, room)}
                    className="flex items-center gap-2.5 px-3 py-2.5 hover:bg-gray-50 cursor-pointer"
                  >
                    <div className="relative flex-shrink-0">
                      <div className={`w-11 h-11 rounded-full flex items-center justify-center text-lg ${
                        room.is_self ? 'bg-blue-100' : room.is_group ? 'bg-green-100' : 'bg-gray-200'
                      }`}>
                        {room.is_self ? '📝' : room.is_group ? '👥' : '👤'}
                      </div>
                      {room.is_pinned && (
                        <div className="absolute -top-1 -right-1 text-xs">📌</div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-800 truncate">{room.display_name || room.name}</p>
                        <span className="text-xs text-gray-400 flex-shrink-0 ml-2">{formatTime(room.last_message_time)}</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <p className="text-xs text-gray-500 truncate">{room.last_message || '메시지가 없습니다'}</p>
                        {(room.unread_count ?? 0) > 0 && (
                          <span className="flex-shrink-0 ml-2 px-1.5 py-0.5 bg-red-500 text-white text-xs rounded-full min-w-[18px] text-center">
                            {room.unread_count}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* 설정 */}
          {activeTab === 'settings' && (
            <div className="p-3 space-y-4">
              {/* 알림 */}
              <div>
                <p className="text-xs text-gray-500 mb-2">알림</p>
                <div 
                  onClick={() => saveSettings({ notificationEnabled: !settings.notificationEnabled })}
                  className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg cursor-pointer"
                >
                  <span className="text-sm text-gray-700">알림 받기</span>
                  <div className={`w-10 h-6 rounded-full relative transition ${settings.notificationEnabled ? 'bg-blue-500' : 'bg-gray-300'}`}>
                    <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.notificationEnabled ? 'right-1' : 'left-1'}`}></div>
                  </div>
                </div>
              </div>

              {/* 채팅창 커스텀 */}
              <div>
                <p className="text-xs text-gray-500 mb-2">채팅창 설정</p>
                
                {/* 배경 컬러 */}
                <div className="px-3 py-2 bg-gray-50 rounded-lg mb-2">
                  <p className="text-sm text-gray-700 mb-2">Background Color</p>
                  <div className="grid grid-cols-5 gap-2">
                    {BG_COLOR_PRESETS.map(color => (
                      <button
                        key={color}
                        onClick={() => saveSettings({ bgColor: color })}
                        className={`w-8 h-8 rounded-full border-2 transition ${
                          settings.bgColor === color ? 'border-blue-500 scale-110' : 'border-gray-200'
                        }`}
                        style={{ backgroundColor: color }}
                      />
                    ))}
                  </div>
                </div>

                {/* 폰트 종류 */}
                <div className="px-3 py-2 bg-gray-50 rounded-lg mb-2">
                  <p className="text-sm text-gray-700 mb-2">Font Family</p>
                  <select 
                    value={settings.fontFamily}
                    onChange={(e) => saveSettings({ fontFamily: e.target.value })}
                    className="w-full px-2 py-1.5 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                  >
                    {FONT_OPTIONS.map(opt => (
                      <option key={opt.value} value={opt.value}>{opt.label}</option>
                    ))}
                  </select>
                </div>

                {/* 폰트 크기 */}
                <div className="px-3 py-2 bg-gray-50 rounded-lg mb-2">
                  <p className="text-sm text-gray-700 mb-2">Font Size</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveSettings({ fontSize: 12 })}
                      className={`flex-1 py-1.5 text-sm rounded-lg transition ${
                        settings.fontSize === 12 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      Small
                    </button>
                    <button
                      onClick={() => saveSettings({ fontSize: 14 })}
                      className={`flex-1 py-1.5 text-sm rounded-lg transition ${
                        settings.fontSize === 14 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      Medium
                    </button>
                    <button
                      onClick={() => saveSettings({ fontSize: 16 })}
                      className={`flex-1 py-1.5 text-sm rounded-lg transition ${
                        settings.fontSize === 16 ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      Large
                    </button>
                  </div>
                </div>

                {/* 폰트 굵기 */}
                <div className="px-3 py-2 bg-gray-50 rounded-lg">
                  <p className="text-sm text-gray-700 mb-2">Font Weight</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => saveSettings({ fontWeight: 'thin' })}
                      className={`flex-1 py-1.5 text-sm font-light rounded-lg transition ${
                        settings.fontWeight === 'thin' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      Thin
                    </button>
                    <button
                      onClick={() => saveSettings({ fontWeight: 'normal' })}
                      className={`flex-1 py-1.5 text-sm rounded-lg transition ${
                        settings.fontWeight === 'normal' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      Normal
                    </button>
                    <button
                      onClick={() => saveSettings({ fontWeight: 'bold' })}
                      className={`flex-1 py-1.5 text-sm font-bold rounded-lg transition ${
                        settings.fontWeight === 'bold' ? 'bg-blue-500 text-white' : 'bg-gray-200 text-gray-700'
                      }`}
                    >
                      Bold
                    </button>
                  </div>
                </div>
              </div>

              {/* 계정 */}
              <div>
                <p className="text-xs text-gray-500 mb-2">계정</p>
                <div className="px-3 py-2 bg-gray-50 rounded-lg mb-2">
                  <p className="text-sm text-gray-700">{user.email}</p>
                </div>
                
                {isElectron && (
                  <div 
                    onClick={() => saveSettings({ autoLogin: !settings.autoLogin })}
                    className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg cursor-pointer mb-2"
                  >
                    <span className="text-sm text-gray-700">자동 로그인</span>
                    <div className={`w-10 h-6 rounded-full relative transition ${settings.autoLogin ? 'bg-blue-500' : 'bg-gray-300'}`}>
                      <div className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${settings.autoLogin ? 'right-1' : 'left-1'}`}></div>
                    </div>
                  </div>
                )}
                
                <button
                  onClick={handleLogout}
                  className="w-full px-3 py-2 text-sm text-red-500 bg-gray-50 rounded-lg hover:bg-red-50 transition"
                >
                  로그아웃
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* 컨텍스트 메뉴 */}
      {contextMenu.show && (
        <div 
          className="fixed bg-white rounded-lg shadow-lg border border-gray-200 py-1 z-50"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          <button
            onClick={handleOpenRoom}
            className="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-100"
          >
            열기
          </button>
          {!contextMenu.isSelf && (
            <>
              <button
                onClick={handlePinRoom}
                className="w-full px-4 py-2 text-sm text-left text-gray-700 hover:bg-gray-100"
              >
                {pinnedRooms.includes(contextMenu.roomId) ? '고정 해제' : '상단 고정'}
              </button>
              <button
                onClick={handleLeaveRoom}
                className="w-full px-4 py-2 text-sm text-left text-red-500 hover:bg-gray-100"
              >
                나가기
              </button>
            </>
          )}
        </div>
      )}

    </div>
  )
}
