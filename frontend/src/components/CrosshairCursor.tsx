import { motion, useMotionValue, useSpring } from 'framer-motion'
import { useEffect, useState } from 'react'
import './CrosshairCursor.css'

type CrosshairCursorProps = {
  className?: string
}

const spring = {
  damping: 34,
  mass: 0.28,
  stiffness: 520,
}

function CrosshairCursor({ className = '' }: CrosshairCursorProps) {
  const pointerX = useMotionValue(0)
  const pointerY = useMotionValue(0)
  const smoothX = useSpring(pointerX, spring)
  const smoothY = useSpring(pointerY, spring)
  const [isPressed, setIsPressed] = useState(false)
  const [isReady, setIsReady] = useState(false)

  useEffect(() => {
    const setInitialPosition = () => {
      pointerX.set(window.innerWidth / 2)
      pointerY.set(window.innerHeight / 2)
      setIsReady(true)
    }

    const handlePointerMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return
      pointerX.set(event.clientX)
      pointerY.set(event.clientY)
      setIsReady(true)
    }

    const handlePointerDown = () => setIsPressed(true)
    const handlePointerUp = () => setIsPressed(false)

    setInitialPosition()
    window.addEventListener('resize', setInitialPosition)
    window.addEventListener('pointermove', handlePointerMove, { passive: true })
    window.addEventListener('pointerdown', handlePointerDown)
    window.addEventListener('pointerup', handlePointerUp)

    return () => {
      window.removeEventListener('resize', setInitialPosition)
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerdown', handlePointerDown)
      window.removeEventListener('pointerup', handlePointerUp)
    }
  }, [pointerX, pointerY])

  return (
    <motion.div
      aria-hidden="true"
      className={`crosshair-cursor ${className}`.trim()}
      data-pressed={isPressed}
      data-ready={isReady}
      style={{ x: smoothX, y: smoothY }}
    >
      <span className="crosshair-cursor__mark">
        <span className="crosshair-cursor__ring" />
        <span className="crosshair-cursor__line crosshair-cursor__line--horizontal" />
        <span className="crosshair-cursor__line crosshair-cursor__line--vertical" />
        <span className="crosshair-cursor__dot" />
      </span>
    </motion.div>
  )
}

export default CrosshairCursor
