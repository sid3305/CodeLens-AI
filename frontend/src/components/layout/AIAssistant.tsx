import { useState } from 'react'
import {
  Bot,
  ChevronDown,
  ChevronRight,
  MessageSquare,
  PanelRightClose,
  Plus,
  Send,
  Sparkles,
} from 'lucide-react'

interface AIAssistantProps {
  collapsed: boolean
  onToggle: () => void
}

export default function AIAssistant({
  collapsed,
  onToggle,
}: AIAssistantProps) {
  const [message, setMessage] = useState('')

  const suggestions = [
    'Explain the project architecture',
    'How does authentication work?',
    'Find important entry points',
  ]

  if (collapsed) {
    return (
      <button
        className="assistant-expand"
        onClick={onToggle}
        title="Open AI assistant"
      >
        <Bot size={20} />
      </button>
    )
  }

  return (
    <aside className="ai-assistant">
      <header className="assistant-header">
        <div className="assistant-title">
          <div className="assistant-avatar">
            <Bot size={18} />
          </div>
          <div>
            <strong>AI Assistant</strong>
            <span>Repository context</span>
          </div>
        </div>

        <div className="assistant-actions">
          <button className="icon-button" title="New conversation">
            <Plus size={16} />
          </button>
          <button
            className="icon-button"
            onClick={onToggle}
            title="Collapse assistant"
          >
            <PanelRightClose size={16} />
          </button>
        </div>
      </header>

      <div className="assistant-context">
        <Sparkles size={14} />
        <span>Ready for repository questions</span>
        <ChevronDown size={14} />
      </div>

      <div className="assistant-messages">
        <div className="assistant-welcome">
          <div className="welcome-icon">
            <MessageSquare size={22} />
          </div>
          <h3>Understand your codebase.</h3>
          <p>
            Ask questions about files, functions, architecture,
            dependencies and issues.
          </p>
        </div>

        <div className="suggestion-list">
          <span className="suggestion-heading">TRY ASKING</span>

          {suggestions.map((suggestion) => (
            <button
              key={suggestion}
              onClick={() => setMessage(suggestion)}
            >
              {suggestion}
              <ChevronRight size={14} />
            </button>
          ))}
        </div>
      </div>

      <div className="assistant-input-area">
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Ask about your repository..."
          rows={3}
        />

        <div className="assistant-input-footer">
          <span>AI responses will be grounded in repository context.</span>
          <button
            className="send-button"
            disabled={!message.trim()}
            title="Send message"
            onClick={() => {
              // Chat API integration will be added later.
              setMessage('')
            }}
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}