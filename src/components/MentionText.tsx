import { Link } from 'react-router-dom'
import { splitMentionText, type MentionTarget } from '../lib/mentions'

interface MentionTextProps {
  text: string
  targets?: MentionTarget[]
}

export default function MentionText({ text, targets = [] }: MentionTextProps) {
  return (
    <>
      {splitMentionText(text, targets).map((segment, index) => {
        if (segment.type === 'text') {
          return <span key={index}>{segment.text}</span>
        }

        if (segment.target) {
          return (
            <Link key={index} to={`/users/${segment.target.uid}`} className="mention-highlight">
              {segment.text}
            </Link>
          )
        }

        return (
          <span key={index} className="mention-highlight">
            {segment.text}
          </span>
        )
      })}
    </>
  )
}
