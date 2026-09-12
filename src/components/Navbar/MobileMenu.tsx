import { useFloatingPresence } from '../../hooks/useFloatingPresence'
import styles from '../Navbar.module.css'

interface MobileMenuProps {
  open: boolean
}

export const MobileMenu = ({ open }: MobileMenuProps) => {
  const presence = useFloatingPresence(open)

  if (!presence.mounted) return null

  return (
    <div
      className={`${styles.siteMobileMenu} floating-expand`}
      data-state={presence.state}
      aria-hidden={!open}
    />
  )
}
