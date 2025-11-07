declare module 'react-helmet-async' {
  import type { ReactNode } from 'react'

  export interface HelmetProviderProps {
    children?: ReactNode
    context?: Record<string, unknown>
  }

  export const HelmetProvider: React.FC<HelmetProviderProps>

  export interface HelmetProps {
    children?: ReactNode
    defer?: boolean
    defaultTitle?: string
    encodeSpecialCharacters?: boolean
    titleAttributes?: Record<string, string>
    prioritizeSeoTags?: boolean
  }

  export const Helmet: React.FC<HelmetProps>
}

