'use client'

import { useState, useEffect, useRef } from 'react'
import { supabase } from '@/lib/supabase'
import { useParams } from 'next/navigation'

interface Message {
  id: string
  content: string
  content_type?: 'text' | 'file' | 'system'
  sender_id: string
  room_id: string
  created_at: string
  reply_to?: string
  read_by?: string[]
  sender?: { name: string }
}

interface ChatRoom {
  id: string
  name: string
  is_group: boolean
  is_self?: boolean
  created_by?: string
}

interface Member {
  id: string
  name: string
  email: string
}

interface BoardPost {
  id: string
  title: string
  content: string
  author_id: string
  room_id: string
  is_important: boolean
  created_at: string
  author?: { name: string }
}

export default function ChatWindow() {
  const params = useParams()
  const roomId = params.roomId as string
  
  const [user, setUser] = useState<any>(null)
  const [profile, setProfile] = useState<any>(null)
  const [room, setRoom] = useState<ChatRoom | null>(null)
  const [messages, setMessages] = useState<Message[]>([])
  const [newMessage, setNewMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [isElectron, setIsElectron] = useState(false)
  const [showSearch, setShowSearch] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [showMembersModal, setShowMembersModal] = useState(false)
  const [showBoardDropdown, setShowBoardDropdown] = useState(false)
  const [showNewPostModal, setShowNewPostModal] = useState(false)
  const [allMembers, setAllMembers] = useState<Member[]>([])
  const [roomMembers, setRoomMembers] = useState<Member[]>([])
  const [showFileModal, setShowFileModal] = useState(false)
  const [filePath, setFilePath] = useState('')
  const [boardPosts, setBoardPosts] = useState<BoardPost[]>([])
  const [newPostContent, setNewPostContent] = useState('')
  const [newPostImportant, setNewPostImportant] = useState(false)
  const [replyTo, setReplyTo] = useState<Message | null>(null)
  const [showMentionList, setShowMentionList] = useState(false)
  const [mentionFilter, setMentionFilter] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [chatSettings, setChatSettings] = useState({
    bgColor: '#666666',
    bgOpacity: 100,
    fontFamily: 'system',
    fontSize: 14,
    fontWeight: 'normal',
  })
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const [isInitialLoad, setIsInitialLoad] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const messagesContainerRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const PAGE_SIZE = 30

  // 설정 로드
  useEffect(() => {
    const loadSettings = () => {
      try {
        const saved = localStorage.getItem('chatSettings')
        console.log('Chat loading settings:', saved)
        if (saved) {
          const parsed = JSON.parse(saved)
          console.log('Chat parsed settings:', parsed)
          setChatSettings(prev => ({ ...prev, ...parsed }))
        }
      } catch (e) {
        console.error('Failed to load chat settings:', e)
      }
    }
    loadSettings()
    
    // 주기적으로 설정 체크 (메신저에서 변경 시 반영)
    const interval = setInterval(loadSettings, 1000)
    
    // storage 변경 감지 (다른 창에서 설정 변경 시)
    const handleStorage = (e: StorageEvent) => {
      if (e.key === 'chatSettings') {
        loadSettings()
      }
    }
    window.addEventListener('storage', handleStorage)
    return () => {
      clearInterval(interval)
      window.removeEventListener('storage', handleStorage)
    }
  }, [])

  useEffect(() => { 
    checkAuth()
    setIsElectron(!!window.electronAPI?.isElectron)
  }, [])
  
  useEffect(() => { 
    if (user && roomId) { 
      fetchProfile()
      fetchRoom()
      fetchMessages().then(() => {
        // 초기 로드 완료 후 스크롤 아래로
        setTimeout(() => scrollToBottom(), 100)
      })
      fetchMembers()
      fetchBoardPosts()
      
      const channel = supabase.channel(`room-${roomId}`)
      
      channel
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'messages',
            filter: `room_id=eq.${roomId}`,
          },
          async (payload) => {
            const newMsg = payload.new as any
            
            const { data: sender } = await supabase
              .from('profiles')
              .select('name')
              .eq('id', newMsg.sender_id)
              .single()
            
            setMessages(prev => {
              // 중복 체크 강화
              if (prev.some(m => m.id === newMsg.id)) {
                return prev
              }
              return [...prev, { ...newMsg, sender }]
            })
            
            if (newMsg.sender_id !== user.id) {
              markMessageAsRead(newMsg.id)
              
              // 알림 보내기 (설정 확인)
              try {
                const savedSettings = localStorage.getItem('chatSettings')
                const settings = savedSettings ? JSON.parse(savedSettings) : { notificationEnabled: true }
                
                if (settings.notificationEnabled) {
                  const senderName = sender?.name || '알 수 없음'
                  const msgContent = newMsg.content_type === 'file' ? '📎 파일을 보냈습니다' : newMsg.content
                  
                  // Electron 알림
                  if (window.electronAPI?.showNotification) {
                    window.electronAPI.showNotification(senderName, msgContent)
                  } else {
                    // 웹 알림 (Electron 아닐 때)
                    if (Notification.permission === 'granted') {
                      new Notification(senderName, { body: msgContent })
                    } else if (Notification.permission !== 'denied') {
                      Notification.requestPermission()
                    }
                  }
                }
              } catch (e) {
                console.error('Notification error:', e)
              }
            }
          }
        )
        .on(
          'postgres_changes',
          {
            event: 'UPDATE',
            schema: 'public',
            table: 'messages',
            filter: `room_id=eq.${roomId}`,
          },
          (payload) => {
            setMessages(prev => prev.map(m => 
              m.id === payload.new.id ? { ...m, read_by: payload.new.read_by } : m
            ))
          }
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'room_members',
            filter: `room_id=eq.${roomId}`,
          },
          async (payload) => {
            // 내가 삭제됐으면 창 닫기
            if (payload.eventType === 'DELETE' && payload.old.user_id === user.id) {
              if (window.electronAPI?.isElectron) {
                window.electronAPI.closeWindow?.()
              } else {
                window.close()
              }
              return
            }
            fetchMembers()
          }
        )
        .subscribe()
      
      return () => {
        supabase.removeChannel(channel)
      }
    }
  }, [user, roomId])
  
  // 새 메시지 도착 시 스크롤 (초기 로드 제외)
  const prevMessagesLength = useRef(0)
  useEffect(() => { 
    // 새 메시지가 추가되었을 때만 스크롤 (이전 메시지 로드 시에는 스크롤 안 함)
    if (messages.length > prevMessagesLength.current && prevMessagesLength.current > 0) {
      scrollToBottom() 
    }
    prevMessagesLength.current = messages.length
  }, [messages])
  
  useEffect(() => {
    if (user && messages.length > 0 && !room?.is_self) {
      markAllAsRead()
    }
  }, [messages.length, user, room])

  const checkAuth = async () => {
    const { data: { session } } = await supabase.auth.getSession()
    if (session?.user) { setUser(session.user) }
    setLoading(false)
  }

  const fetchProfile = async () => {
    const { data } = await supabase.from('profiles').select('*').eq('id', user.id).single()
    if (data) setProfile(data)
  }

  const fetchRoom = async () => {
    const { data } = await supabase.from('chat_rooms').select('*').eq('id', roomId).single()
    if (data) {
      setRoom(data)
    }
  }

  const fetchMessages = async (loadMore = false) => {
    if (loadMore) {
      setLoadingMore(true)
    }
    
    let query = supabase
      .from('messages')
      .select('*, sender:profiles!sender_id(name)')
      .eq('room_id', roomId)
      .order('created_at', { ascending: false })
      .limit(PAGE_SIZE)
    
    // 추가 로드 시: 가장 오래된 메시지보다 이전 것들
    if (loadMore && messages.length > 0) {
      const oldestMsg = messages[0]
      query = query.lt('created_at', oldestMsg.created_at)
    }
    
    const { data } = await query
    
    if (data) {
      // 시간순 정렬 (오래된 것 → 최신)
      const sorted = data.reverse()
      
      if (loadMore) {
        // 이전 메시지 앞에 추가
        setMessages(prev => [...sorted, ...prev])
        setHasMore(data.length === PAGE_SIZE)
      } else {
        setMessages(sorted)
        setHasMore(data.length === PAGE_SIZE)
        setIsInitialLoad(false)
      }
    }
    
    setLoadingMore(false)
  }
  
  // 스크롤 맨 위 감지 → 이전 메시지 로드
  const handleScroll = () => {
    const container = messagesContainerRef.current
    if (!container || loadingMore || !hasMore) return
    
    // 맨 위에서 50px 이내면 로드
    if (container.scrollTop < 50) {
      const prevScrollHeight = container.scrollHeight
      fetchMessages(true).then(() => {
        // 스크롤 위치 유지
        requestAnimationFrame(() => {
          const newScrollHeight = container.scrollHeight
          container.scrollTop = newScrollHeight - prevScrollHeight
        })
      })
    }
  }

  const fetchMembers = async () => {
    const { data: all } = await supabase.from('profiles').select('id, name, email')
    if (all) setAllMembers(all)
    
    const { data: memberIds } = await supabase
      .from('room_members')
      .select('user_id')
      .eq('room_id', roomId)
    
    if (memberIds && all) {
      const userIds = memberIds.map((m: any) => m.user_id)
      const memberList = all.filter((p: any) => userIds.includes(p.id))
      setRoomMembers(memberList)
    }
  }

  const fetchBoardPosts = async () => {
    const { data } = await supabase
      .from('board_posts')
      .select('*, author:profiles!author_id(name)')
      .eq('room_id', roomId)
      .order('is_important', { ascending: false })
      .order('created_at', { ascending: false })
    if (data) setBoardPosts(data)
  }

  const markAllAsRead = async () => {
    if (!user) return
    
    const unreadMessages = messages.filter(msg => {
      if (msg.sender_id === user.id) return false
      const readBy = msg.read_by || []
      return !readBy.includes(user.id)
    })
    
    for (const msg of unreadMessages) {
      await markMessageAsRead(msg.id)
    }
  }

  const markMessageAsRead = async (messageId: string) => {
    if (!user) return
    
    const { data: msg } = await supabase
      .from('messages')
      .select('read_by')
      .eq('id', messageId)
      .single()
    
    if (msg) {
      const readBy = msg.read_by || []
      if (!readBy.includes(user.id)) {
        await supabase
          .from('messages')
          .update({ read_by: [...readBy, user.id] })
          .eq('id', messageId)
      }
    }
  }

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  const handleSend = async () => {
    if (!newMessage.trim() || !roomId || !user || isSending) return
    
    setIsSending(true)
    
    const messageData: any = {
      content: newMessage.trim(),
      content_type: 'text',
      sender_id: user.id,
      room_id: roomId,
      read_by: [user.id],
    }
    
    if (replyTo) {
      messageData.reply_to = replyTo.id
    }
    
    setNewMessage('')
    setReplyTo(null)
    
    const { error } = await supabase.from('messages').insert(messageData)
    
    if (error) {
      alert('메시지 전송에 실패했습니다: ' + error.message)
    }
    
    setIsSending(false)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // 한글 조합 중이면 무시 (nativeEvent.isComposing)
    if (e.nativeEvent.isComposing) return
    
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = e.target.value
    setNewMessage(value)
    
    const lastAtIndex = value.lastIndexOf('@')
    if (lastAtIndex !== -1) {
      const textAfterAt = value.slice(lastAtIndex + 1)
      const spaceIndex = textAfterAt.indexOf(' ')
      
      if (spaceIndex === -1) {
        setMentionFilter(textAfterAt.toLowerCase())
        setShowMentionList(true)
      } else {
        setShowMentionList(false)
      }
    } else {
      setShowMentionList(false)
    }
  }

  const insertMention = (member: Member) => {
    const lastAtIndex = newMessage.lastIndexOf('@')
    const beforeAt = newMessage.slice(0, lastAtIndex)
    const memberName = member.name || member.email?.split('@')[0]
    setNewMessage(`${beforeAt}@${memberName} `)
    setShowMentionList(false)
    textareaRef.current?.focus()
  }

  const handleSendFile = async () => {
    if (!filePath.trim() || !roomId || !user) return
    
    await supabase.from('messages').insert({
      content: filePath.trim(),
      content_type: 'file',
      sender_id: user.id,
      room_id: roomId,
      read_by: [user.id],
    })
    setFilePath('')
    setShowFileModal(false)
  }

  const handleInviteMember = async (memberId: string) => {
    await supabase.from('room_members').insert({
      room_id: roomId,
      user_id: memberId,
    })
    const member = allMembers.find(m => m.id === memberId)
    if (member) setRoomMembers(prev => [...prev, member])
  }

  const handleCreatePost = async () => {
    if (!newPostContent.trim()) return
    await supabase.from('board_posts').insert({
      title: '',
      content: newPostContent.trim(),
      author_id: user.id,
      room_id: roomId,
      is_important: newPostImportant,
    })
    
    setNewPostContent('')
    setNewPostContent('')
    setNewPostImportant(false)
    setShowNewPostModal(false)
    fetchBoardPosts()
  }

  const handleToggleImportant = async (postId: string, currentValue: boolean) => {
    await supabase.from('board_posts').update({ is_important: !currentValue }).eq('id', postId)
    fetchBoardPosts()
  }

  const handleDeletePost = async (postId: string) => {
    if (!confirm('게시글을 삭제하시겠습니까?')) return
    await supabase.from('board_posts').delete().eq('id', postId)
    fetchBoardPosts()
  }

  const handleClose = () => {
    window.electronAPI?.closeWindow?.()
  }

  const handleMinimize = () => {
    window.electronAPI?.minimizeWindow?.()
  }

  const openFilePath = (filePath: string) => {
    if (window.electronAPI?.openPath) {
      window.electronAPI.openPath(filePath)
    } else {
      // 웹에서는 경로만 보여줌
      alert(`파일 경로: ${filePath}\n\n이 경로를 파일 탐색기에서 열어주세요.`)
    }
  }

  const formatTime = (dateString: string) => {
    return new Date(dateString).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })
  }

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' })
  }

  const getReplyMessage = (replyToId: string) => {
    return messages.find(m => m.id === replyToId)
  }

  const getUnreadCount = (msg: Message) => {
    if (msg.sender_id !== user?.id) return 0
    if (room?.is_self) return 0
    const readBy = msg.read_by || []
    const totalMembers = roomMembers.length
    const readCount = readBy.length
    return Math.max(0, totalMembers - readCount)
  }

  const filteredMessages = searchQuery 
    ? messages.filter(m => m.content.toLowerCase().includes(searchQuery.toLowerCase()))
    : messages

  const availableMembers = allMembers.filter(m => 
    m.id !== user?.id && !roomMembers.some(rm => rm.id === m.id)
  )

  const filteredMentionMembers = roomMembers.filter(m => {
    const name = (m.name || m.email?.split('@')[0] || '').toLowerCase()
    return name.includes(mentionFilter)
  })

  // 참여자 숫자 (나 포함)
  const memberCount = roomMembers.length
  
  // 참여자 이름 (나 제외)
  const otherMembers = roomMembers.filter(m => m.id !== user?.id)
  const displayName = room?.is_self 
    ? '나와의 채팅' 
    : otherMembers.length > 0 
      ? otherMembers.map(m => m.name || m.email?.split('@')[0]).join(', ')
      : '대화 상대 없음'

  // 폰트 패밀리 매핑 (영문/숫자용)
  const getEnFontFamily = () => {
    const fontMap: Record<string, string> = {
      'system': '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      'Pretendard': '"Pretendard", -apple-system, sans-serif',
      'NanumGothic': '"Nanum Gothic", sans-serif',
      'NotoSansKR': '"Noto Sans KR", sans-serif',
    }
    return fontMap[chatSettings.fontFamily] || fontMap['system']
  }

  // 폰트 웨이트 매핑
  const getFontWeight = () => {
    const weightMap: Record<string, number> = {
      'thin': 300,
      'normal': 400,
      'bold': 600,
    }
    return weightMap[chatSettings.fontWeight] || 400
  }

  // 메시지 텍스트 스타일 (영문/숫자만 폰트 적용)
  const getMessageStyle = () => ({
    fontSize: `${chatSettings.fontSize}px`,
  })

  // 영문/숫자 감싸는 스타일 (폰트 패밀리만)
  const enStyle = {
    fontFamily: getEnFontFamily(),
  }

  // 메시지 내용 렌더링 (영문/숫자에만 폰트 패밀리 적용, 웨이트는 전체)
  const renderMessageContent = (content: string) => {
    const urlRegex = /(https?:\/\/[^\s]+)/g
    const parts = content.split(urlRegex)
    
    return parts.map((part, index) => {
      if (urlRegex.test(part)) {
        return (
          <a 
            key={index}
            href={part}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:opacity-80"
            style={enStyle}
            onClick={(e) => e.stopPropagation()}
          >
            {part}
          </a>
        )
      }
      // 영문/숫자와 한글 분리해서 폰트 패밀리만 적용
      const segments = part.split(/([a-zA-Z0-9\s.,!?@#$%^&*()_+\-=\[\]{}|;:'",.<>\/\\]+)/g)
      return segments.map((seg, i) => {
        if (/^[a-zA-Z0-9\s.,!?@#$%^&*()_+\-=\[\]{}|;:'",.<>\/\\]+$/.test(seg)) {
          return <span key={`${index}-${i}`} style={enStyle}>{seg}</span>
        }
        return <span key={`${index}-${i}`}>{seg}</span>
      })
    })
  }

  // 배경색 밝기 계산 (0~255, 높을수록 밝음)
  const getBrightness = (hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16)
    const g = parseInt(hex.slice(3, 5), 16)
    const b = parseInt(hex.slice(5, 7), 16)
    return (r * 299 + g * 587 + b * 114) / 1000
  }

  // 배경이 밝은지 여부
  const isLightBg = getBrightness(chatSettings.bgColor) > 128

  // 텍스트 색상 (배경에 따라)
  const textColor = isLightBg ? '#1f2937' : '#ffffff'
  const textColorMuted = isLightBg ? '#6b7280' : '#9ca3af'
  const textColorFaint = isLightBg ? '#9ca3af' : '#6b7280'

  // 내 메시지 박스 색상
  const myMsgBg = isLightBg ? '#3b82f6' : '#aacbec'
  const myMsgText = isLightBg ? '#ffffff' : '#1f2937'

  // 상대방 메시지 박스 색상  
  const otherMsgBg = isLightBg ? '#f3f4f6' : '#ffffff'
  const otherMsgText = '#1f2937'

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center" style={{ backgroundColor: chatSettings.bgColor }}>
        <div className="animate-spin w-5 h-5 border-2 border-white border-t-transparent rounded-full"></div>
      </div>
    )
  }

  if (!user) {
    return (
      <div className="h-screen flex flex-col items-center justify-center p-4" style={{ backgroundColor: chatSettings.bgColor }}>
        <p style={{ color: textColorMuted }} className="text-xs">로그인이 필요합니다</p>
      </div>
    )
  }

  return (
    <div 
      className="h-screen flex flex-col"
      style={{ 
        backgroundColor: chatSettings.bgColor,
        fontSize: `${chatSettings.fontSize}px`,
        color: textColor,
      }}
    >
      {/* 헤더 */}
      <div 
        className="flex-shrink-0 px-3 py-2"
        style={{ backgroundColor: chatSettings.bgColor, WebkitAppRegion: 'drag' } as any}
      >
        <div className="flex items-center justify-between mb-[10px] min-h-[16px]">
          {isElectron && (
            <div className="flex gap-1.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
              <button onClick={handleClose} className="w-3 h-3 rounded-full bg-[#ff5f57] hover:brightness-90 transition" />
              <button onClick={handleMinimize} className="w-3 h-3 rounded-full bg-[#ffbd2e] hover:brightness-90 transition" />
              <button className="w-3 h-3 rounded-full bg-[#28c840] hover:brightness-90 transition" />
            </div>
          )}
          <div className="flex-1" />
        </div>
        
        <div className="flex items-center gap-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
          <div className="w-9 h-9 bg-white/20 rounded-full flex items-center justify-center flex-shrink-0">
            <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
            </svg>
          </div>
          
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-white truncate">{displayName}</p>
            {!room?.is_self && memberCount > 0 && (
              <button 
                onClick={() => setShowMembersModal(true)}
                className="text-xs text-gray-300 hover:text-white"
              >
                {memberCount}명
              </button>
            )}
          </div>
          
          <div className="flex items-center gap-1 flex-shrink-0">
            <button
              onClick={() => setShowSearch(!showSearch)}
              className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
            </button>
            
            <button
              onClick={() => {
                if (boardPosts.length > 0) {
                  setShowBoardDropdown(!showBoardDropdown)
                } else {
                  setShowNewPostModal(true)
                }
              }}
              className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </button>
            
            {!room?.is_self && (
              <button
                onClick={() => setShowInviteModal(true)}
                className="w-8 h-8 flex items-center justify-center text-gray-300 hover:text-white hover:bg-white/10 rounded-full transition"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M18 9v3m0 0v3m0-3h3m-3 0h-3m-2-5a4 4 0 11-8 0 4 4 0 018 0zM3 20a6 6 0 0112 0v1H3v-1z" />
                </svg>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 게시판 드롭다운 (카카오톡 공지 스타일) */}
      {boardPosts.length > 0 && (
        <div className="bg-white flex-shrink-0 border-b border-gray-200">
          {/* 접힌 상태: 최신 글 1개만 */}
          <div 
            className="flex items-center gap-2 px-3 py-2 cursor-pointer hover:bg-gray-50"
            onClick={() => setShowBoardDropdown(!showBoardDropdown)}
          >
            <svg className="w-4 h-4 text-[#5b9bd5] flex-shrink-0" fill="currentColor" viewBox="0 0 24 24">
              <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
            </svg>
            <div className="flex-1 min-w-0">
              <p className="text-xs text-gray-500">{boardPosts[0].author?.name || '알 수 없음'}</p>
              <p className="text-sm text-gray-800 truncate">{boardPosts[0].content}</p>
            </div>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${showBoardDropdown ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
            </svg>
          </div>
          
          {/* 펼친 상태: 전체 목록 */}
          {showBoardDropdown && (
            <div className="max-h-48 overflow-y-auto border-t border-gray-100">
              {boardPosts.map((post, index) => (
                <div 
                  key={post.id} 
                  className={`flex items-center gap-2 px-3 py-2 ${index > 0 ? 'border-t border-gray-100' : ''} hover:bg-gray-50`}
                >
                  <div className="flex-1 min-w-0">
                    <p className="text-xs text-gray-500">{post.author?.name || '알 수 없음'}</p>
                    <p className="text-sm text-gray-800 truncate">{post.content}</p>
                  </div>
                  {post.author_id === user.id && (
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleToggleImportant(post.id, post.is_important); }}
                        className={`p-1 rounded ${post.is_important ? 'text-yellow-500' : 'text-gray-400 hover:text-yellow-500'}`}
                      >
                        📌
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePost(post.id); }}
                        className="p-1 text-gray-400 hover:text-red-500"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                        </svg>
                      </button>
                    </div>
                  )}
                </div>
              ))}
              {/* 글쓰기 버튼 */}
              <button
                onClick={() => setShowNewPostModal(true)}
                className="w-full py-2 text-sm text-[#5b9bd5] hover:bg-gray-50 border-t border-gray-100"
              >
                + 새 글 작성
              </button>
            </div>
          )}
        </div>
      )}

      {/* 검색창 */}
      {showSearch && (
        <div className="px-3 py-2 flex-shrink-0" style={{ backgroundColor: chatSettings.bgColor }}>
          <input
            type="text"
            placeholder="대화 내용 검색..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full px-3 py-2 text-[13px] bg-white/10 text-white placeholder-gray-400 rounded-lg focus:outline-none focus:ring-1 focus:ring-white/30"
            autoFocus
          />
        </div>
      )}

      {/* 메시지 목록 */}
      <div 
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-3 space-y-3"
      >
        {/* 이전 메시지 로딩 스피너 */}
        {loadingMore && (
          <div className="flex justify-center py-2">
            <div className="animate-spin w-5 h-5 border-2 border-gray-300 border-t-transparent rounded-full"></div>
          </div>
        )}
        
        {/* 더 불러올 메시지 있음 표시 */}
        {hasMore && !loadingMore && messages.length > 0 && (
          <div className="flex justify-center py-2">
            <span className="text-xs" style={{ color: textColorMuted }}>↑ 스크롤하여 이전 메시지 보기</span>
          </div>
        )}
        
        {filteredMessages.length === 0 ? (
          <p className="text-center text-gray-400 text-xs mt-8">
            {searchQuery ? '검색 결과가 없습니다' : room?.is_self ? '메모를 작성해보세요 ✏️' : '첫 메시지를 보내보세요 👋'}
          </p>
        ) : (
          filteredMessages.map((msg, index) => {
            const isMe = msg.sender_id === user.id
            const isFile = msg.content_type === 'file'
            const isSystem = msg.content_type === 'system'
            const replyMsg = msg.reply_to ? getReplyMessage(msg.reply_to) : null
            const unreadCount = getUnreadCount(msg)
            
            const prevMsg = index > 0 ? filteredMessages[index - 1] : null
            const nextMsg = index < filteredMessages.length - 1 ? filteredMessages[index + 1] : null
            const isSameSender = prevMsg && prevMsg.sender_id === msg.sender_id && prevMsg.content_type !== 'system'
            const showProfile = !isMe && !room?.is_self && !isSameSender && !isSystem
            
            // 시간 표시 여부: 다음 메시지가 없거나, 다음 메시지가 다른 발신자거나, 1분 이상 차이나면 표시
            const msgTime = new Date(msg.created_at)
            const nextMsgTime = nextMsg ? new Date(nextMsg.created_at) : null
            const isSameMinute = nextMsgTime && 
              msgTime.getHours() === nextMsgTime.getHours() && 
              msgTime.getMinutes() === nextMsgTime.getMinutes()
            const isNextSameSender = nextMsg && nextMsg.sender_id === msg.sender_id && nextMsg.content_type !== 'system'
            const showTime = !nextMsg || !isNextSameSender || !isSameMinute
            
            // 시스템 메시지 (나갔습니다 등)
            if (isSystem) {
              return (
                <div key={msg.id} className="flex justify-center my-2">
                  <span className="px-3 py-1 text-xs text-gray-300 bg-gray-600/50 rounded-full">
                    {msg.content}
                  </span>
                </div>
              )
            }
            
            return (
              <div key={msg.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'} group`}>
                {/* 상대방 프로필 */}
                {!isMe && !room?.is_self && (
                  <div className="w-9 flex-shrink-0 mr-2">
                    {showProfile && (
                      <div className="w-9 h-9 bg-gray-400 rounded-full flex items-center justify-center">
                        <svg className="w-5 h-5 text-white" fill="currentColor" viewBox="0 0 24 24">
                          <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                        </svg>
                      </div>
                    )}
                  </div>
                )}
                
                <div className="max-w-[70%]">
                  {/* 상대방 이름 */}
                  {showProfile && (
                    <p className="text-xs text-gray-300 mb-1">{msg.sender?.name || '알 수 없음'}</p>
                  )}
                  
                  <div className="flex items-end gap-1">
                    {/* 답장 버튼 (내 메시지) */}
                    {isMe && (
                      <button
                        onClick={() => setReplyTo(msg)}
                        className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-white transition"
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                        </svg>
                      </button>
                    )}
                    
                    {/* 내 메시지: 읽음 표시 + 시간 */}
                    {isMe && showTime && (
                      <div className="flex flex-col items-end justify-end">
                        {unreadCount > 0 && (
                          <span className="text-[10px] font-medium" style={{ color: isLightBg ? '#3b82f6' : '#6d83a9' }}>{unreadCount}</span>
                        )}
                        <span className="text-[10px]" style={{ color: textColorMuted }}>{formatTime(msg.created_at)}</span>
                      </div>
                    )}
                    
                    {/* 내 메시지: 읽음 표시만 (시간 안 보일 때) */}
                    {isMe && !showTime && unreadCount > 0 && (
                      <div className="flex flex-col items-end justify-end">
                        <span className="text-[10px] font-medium" style={{ color: isLightBg ? '#3b82f6' : '#6d83a9' }}>{unreadCount}</span>
                      </div>
                    )}
                    
                    <div>
                      {/* 답장 표시 */}
                      {replyMsg && (
                        <div 
                          className="text-xs px-2 py-1 mb-1 rounded"
                          style={{ 
                            backgroundColor: isMe ? (isLightBg ? '#bfdbfe' : '#7eb8e7') : (isLightBg ? '#e5e7eb' : '#d1d5db'),
                            color: '#374151'
                          }}
                        >
                          <span className="font-medium">{replyMsg.sender?.name || '알 수 없음'}</span>에게 답장
                          <p className="truncate">{replyMsg.content}</p>
                        </div>
                      )}
                      
                      {isFile ? (
                        <button
                          onClick={() => openFilePath(msg.content)}
                          className="relative px-2.5 py-1.5 flex items-center gap-2 rounded"
                          style={{
                            backgroundColor: isMe ? myMsgBg : otherMsgBg,
                            color: isMe ? myMsgText : otherMsgText,
                            fontSize: `${chatSettings.fontSize}px`,
                            fontWeight: getFontWeight(),
                          }}
                        >
                          {/* 꼬리 */}
                          {isMe ? (
                            <span 
                              className="absolute bottom-2"
                              style={{
                                right: '-6px',
                                width: 0,
                                height: 0,
                                borderTop: '6px solid transparent',
                                borderBottom: '6px solid transparent',
                                borderLeft: `6px solid ${myMsgBg}`,
                              }}
                            />
                          ) : (
                            <span 
                              className="absolute bottom-2"
                              style={{
                                left: '-6px',
                                width: 0,
                                height: 0,
                                borderTop: '6px solid transparent',
                                borderBottom: '6px solid transparent',
                                borderRight: `6px solid ${otherMsgBg}`,
                              }}
                            />
                          )}
                          <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" d="M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z" />
                          </svg>
                          <span className="underline break-all">{msg.content.split(/[/\\]/).pop() || msg.content}</span>
                        </button>
                      ) : (
                        <div 
                          className="relative px-2.5 py-1.5 whitespace-pre-wrap break-all rounded"
                          style={{
                            backgroundColor: isMe ? myMsgBg : otherMsgBg,
                            color: isMe ? myMsgText : otherMsgText,
                            fontSize: `${chatSettings.fontSize}px`,
                            fontWeight: getFontWeight(),
                          }}
                        >
                          {/* 꼬리 */}
                          {isMe ? (
                            <span 
                              className="absolute bottom-2"
                              style={{
                                right: '-6px',
                                width: 0,
                                height: 0,
                                borderTop: '6px solid transparent',
                                borderBottom: '6px solid transparent',
                                borderLeft: `6px solid ${myMsgBg}`,
                              }}
                            />
                          ) : (
                            <span 
                              className="absolute bottom-2"
                              style={{
                                left: '-6px',
                                width: 0,
                                height: 0,
                                borderTop: '6px solid transparent',
                                borderBottom: '6px solid transparent',
                                borderRight: `6px solid ${otherMsgBg}`,
                              }}
                            />
                          )}
                          {renderMessageContent(msg.content)}
                        </div>
                      )}
                    </div>
                    
                    {/* 상대방 메시지: 시간 */}
                    {!isMe && showTime && (
                      <span className="text-[10px] self-end" style={{ color: textColorMuted }}>{formatTime(msg.created_at)}</span>
                    )}
                    
                    {/* 답장 버튼 (상대방 메시지) */}
                    {!isMe && (
                      <button
                        onClick={() => setReplyTo(msg)}
                        className="opacity-0 group-hover:opacity-100 p-1 transition"
                        style={{ color: textColorMuted }}
                      >
                        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
                        </svg>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* 답장 표시 */}
      {replyTo && (
        <div className="px-3 py-2 bg-[#444444] flex items-center justify-between">
          <div className="flex-1 min-w-0">
            <p className="text-xs text-[#7eb8e7]">{replyTo.sender?.name || '알 수 없음'}에게 답장</p>
            <p className="text-xs text-gray-400 truncate">{replyTo.content}</p>
          </div>
          <button onClick={() => setReplyTo(null)} className="text-gray-400 hover:text-white ml-2">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* 멘션 리스트 */}
      {showMentionList && filteredMentionMembers.length > 0 && (
        <div className="px-3 py-2 bg-[#444444] border-t border-gray-600">
          <p className="text-xs text-gray-400 mb-1">멤버 선택</p>
          <div className="flex flex-wrap gap-1">
            {filteredMentionMembers.map(member => (
              <button
                key={member.id}
                onClick={() => insertMention(member)}
                className="px-2 py-1 text-xs bg-white/10 text-white rounded hover:bg-white/20"
              >
                @{member.name || member.email?.split('@')[0]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* 입력창 */}
      <div className="bg-white flex-shrink-0">
        <textarea
          ref={textareaRef}
          value={newMessage}
          onChange={handleMessageChange}
          onKeyDown={handleKeyDown}
          placeholder={room?.is_self ? '메모 입력...' : '메시지 입력... (@로 멘션)'}
          className="w-full px-3 py-2 text-[13px] bg-white text-gray-900 focus:outline-none resize-none border-0"
          style={{ height: '80px' }}
        />
        
        <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100">
          <button
            onClick={() => setShowFileModal(true)}
            className="w-7 h-7 flex items-center justify-center text-gray-400 hover:text-gray-600 rounded transition"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.5} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
            </svg>
          </button>
          
          <button
            onClick={handleSend}
            disabled={!newMessage.trim() || isSending}
            className={`w-8 h-8 rounded-full flex items-center justify-center transition ${
              newMessage.trim() && !isSending
                ? 'bg-[#5b9bd5] text-white hover:bg-[#4a8bc5]' 
                : 'bg-gray-200 text-gray-400 cursor-not-allowed'
            }`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
            </svg>
          </button>
        </div>
      </div>

      {/* 새 게시글 작성 모달 */}
      {showNewPostModal && (
        <div 
          className="fixed inset-0 bg-black/30 flex items-center justify-center" 
          style={{ zIndex: 100000 }}
          onClick={() => setShowNewPostModal(false)}
        >
          <div className="bg-white rounded-xl p-4 w-[90%] max-w-[360px] shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-gray-800">새 메모</p>
              <button onClick={() => setShowNewPostModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            
            <textarea
              value={newPostContent}
              onChange={(e) => setNewPostContent(e.target.value)}
              placeholder="내용을 입력하세요"
              className="w-full px-3 py-2 text-[13px] text-gray-800 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300 mb-2 resize-none"
              rows={4}
              autoFocus
            />
            
            <label className="flex items-center gap-2 mb-3 cursor-pointer">
              <input
                type="checkbox"
                checked={newPostImportant}
                onChange={(e) => setNewPostImportant(e.target.checked)}
                className="w-4 h-4 rounded border-gray-300 text-blue-500 focus:ring-blue-500"
              />
              <span className="text-[13px] text-gray-700">📌 중요 글로 등록</span>
            </label>
            
            <div className="flex gap-2">
              <button
                onClick={() => setShowNewPostModal(false)}
                className="flex-1 py-2 text-[13px] text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleCreatePost}
                disabled={!newPostContent.trim()}
                className="flex-1 py-2 text-[13px] text-white bg-[#5b9bd5] rounded-lg hover:bg-[#4a8bc5] disabled:opacity-50"
              >
                작성
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 멤버 목록 모달 */}
      {showMembersModal && (
        <div 
          className="fixed inset-0 bg-black/30 flex items-center justify-center" 
          style={{ zIndex: 99999 }}
          onClick={() => setShowMembersModal(false)}
        >
          <div className="bg-white rounded-xl p-4 w-[90%] max-w-[360px] max-h-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-gray-800">참여 멤버 ({memberCount}명)</p>
              <button onClick={() => setShowMembersModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            
            <div className="space-y-1 max-h-52 overflow-y-auto">
              {roomMembers.map(member => (
                <div key={member.id} className="flex items-center gap-2 p-2 rounded-lg hover:bg-gray-50">
                  <div className="w-8 h-8 rounded-full flex items-center justify-center bg-gray-200">
                    <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                    </svg>
                  </div>
                  <p className="text-[13px] text-gray-800">
                    {member.id === user.id ? `${member.name || member.email?.split('@')[0]} (나)` : member.name || member.email?.split('@')[0]}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 멤버 초대 모달 */}
      {showInviteModal && (
        <div 
          className="fixed inset-0 bg-black/30 flex items-center justify-center" 
          style={{ zIndex: 99999 }}
          onClick={() => setShowInviteModal(false)}
        >
          <div className="bg-white rounded-xl p-4 w-[90%] max-w-[360px] max-h-80 shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-gray-800">멤버 초대</p>
              <button onClick={() => setShowInviteModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            
            {availableMembers.length === 0 ? (
              <p className="text-center text-gray-400 text-[13px] py-4">초대할 수 있는 멤버가 없습니다</p>
            ) : (
              <div className="space-y-1 max-h-52 overflow-y-auto">
                {availableMembers.map(member => (
                  <div
                    key={member.id}
                    onClick={() => handleInviteMember(member.id)}
                    className="flex items-center gap-2 p-2 hover:bg-gray-50 rounded-lg cursor-pointer"
                  >
                    <div className="w-8 h-8 bg-gray-200 rounded-full flex items-center justify-center text-[13px]">
                      <svg className="w-4 h-4 text-gray-600" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/>
                      </svg>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] text-gray-800 truncate">{member.name || member.email?.split('@')[0]}</p>
                    </div>
                    <span className="text-xs text-blue-500">초대</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 파일 경로 입력 모달 */}
      {showFileModal && (
        <div 
          className="fixed inset-0 bg-black/30 flex items-center justify-center" 
          style={{ zIndex: 99999 }}
          onClick={() => setShowFileModal(false)}
        >
          <div className="bg-white rounded-xl p-4 w-[90%] max-w-[360px] shadow-xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-medium text-gray-800">파일 경로 공유</p>
              <button onClick={() => setShowFileModal(false)} className="text-gray-400 hover:text-gray-600">✕</button>
            </div>
            
            <p className="text-xs text-gray-500 mb-2">NAS 또는 공유 폴더 경로를 입력하세요</p>
            
            <div className="flex gap-2 mb-3">
              <input
                type="text"
                value={filePath}
                onChange={(e) => setFilePath(e.target.value)}
                placeholder="예: \\nas\공유폴더\파일.pdf"
                className="flex-1 px-3 py-2 text-[13px] text-gray-900 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-300"
                autoFocus
              />
              {isElectron && (
                <button
                  onClick={async () => {
                    const selected = await window.electronAPI?.selectFile()
                    if (selected) setFilePath(selected)
                  }}
                  className="px-3 py-2 text-[13px] text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200 whitespace-nowrap"
                >
                  찾아보기
                </button>
              )}
            </div>
            
            <div className="flex gap-2">
              <button
                onClick={() => setShowFileModal(false)}
                className="flex-1 py-2 text-[13px] text-gray-600 bg-gray-100 rounded-lg hover:bg-gray-200"
              >
                취소
              </button>
              <button
                onClick={handleSendFile}
                disabled={!filePath.trim()}
                className="flex-1 py-2 text-[13px] text-white bg-[#5b9bd5] rounded-lg hover:bg-[#4a8bc5] disabled:opacity-50"
              >
                전송
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
