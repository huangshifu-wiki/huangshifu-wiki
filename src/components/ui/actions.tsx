import * as SlotPrimitive from '@radix-ui/react-slot'
import { Loader2 } from '@/src/components/icons'
import React from 'react'
import { Link, type LinkProps } from 'react-router-dom'
import { cn } from './utils'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'warning' | 'success'

export type ButtonSize = 'sm' | 'md' | 'lg'

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'theme-button-primary border-transparent',
  secondary:
    'border-[var(--book-ink-line)] bg-[var(--book-panel-bg)] text-text-secondary hover:border-brand-gold/50 hover:text-brand-gold',
  ghost: 'border-transparent text-text-secondary hover:bg-surface-alt hover:text-brand-gold',
  danger: 'theme-button-danger border-transparent',
  warning: 'theme-button-warning border-transparent',
  success: 'theme-button-success border-transparent',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'min-h-8 px-3 py-1.5 text-xs',
  md: 'min-h-10 px-4 py-2 text-sm',
  lg: 'min-h-12 px-5 py-3 text-base',
}

export const buttonVariants = ({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  className,
}: {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  className?: string
} = {}) =>
  cn(
    'inline-flex select-none items-center justify-center gap-2 rounded border font-medium transition-all duration-200',
    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-theme-accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary',
    'active:scale-[0.97] disabled:pointer-events-none disabled:opacity-50',
    variantClasses[variant],
    sizeClasses[size],
    fullWidth && 'w-full',
    className
  )

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  asChild?: boolean
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  loadingText?: React.ReactNode
  fullWidth?: boolean
  leftIcon?: React.ReactNode
  rightIcon?: React.ReactNode
}

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      asChild = false,
      variant = 'primary',
      size = 'md',
      loading = false,
      loadingText,
      fullWidth = false,
      leftIcon,
      rightIcon,
      className,
      children,
      disabled,
      type = 'button',
      ...props
    },
    ref
  ) => {
    const Component = asChild ? SlotPrimitive.Slot : 'button'
    return (
      <Component
        ref={ref}
        type={asChild ? undefined : type}
        className={buttonVariants({ variant, size, fullWidth, className })}
        disabled={asChild ? undefined : disabled || loading}
        aria-disabled={disabled || loading || undefined}
        aria-busy={loading || undefined}
        {...props}
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : leftIcon}
        {loading && loadingText !== undefined ? loadingText : children}
        {!loading && rightIcon}
      </Component>
    )
  }
)
Button.displayName = 'Button'

export type LinkButtonProps = LinkProps &
  Pick<ButtonProps, 'variant' | 'size' | 'fullWidth' | 'leftIcon' | 'rightIcon'>

export const LinkButton = React.forwardRef<HTMLAnchorElement, LinkButtonProps>(
  (
    {
      variant = 'primary',
      size = 'md',
      fullWidth = false,
      leftIcon,
      rightIcon,
      className,
      children,
      ...props
    },
    ref
  ) => (
    <Link
      ref={ref}
      className={buttonVariants({ variant, size, fullWidth, className })}
      data-pressable
      {...props}
    >
      {leftIcon}
      {children}
      {rightIcon}
    </Link>
  )
)
LinkButton.displayName = 'LinkButton'

export interface IconButtonProps extends Omit<ButtonProps, 'leftIcon' | 'rightIcon'> {
  'aria-label': string
}

export const IconButton = React.forwardRef<HTMLButtonElement, IconButtonProps>(
  ({ size = 'md', className, children, ...props }, ref) => (
    <Button
      ref={ref}
      size={size}
      className={cn(
        size === 'sm' && 'h-8 w-8 min-h-0 p-0',
        size === 'md' && 'h-10 w-10 min-h-0 p-0',
        size === 'lg' && 'h-12 w-12 min-h-0 p-0',
        className
      )}
      {...props}
    >
      {children}
    </Button>
  )
)
IconButton.displayName = 'IconButton'
