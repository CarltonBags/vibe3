# Component Usage Examples

This directory contains examples of how to properly use shadcn/ui components.

## Key Principles:

1. **All UI components from `@/components/ui/` have NO required props by default**
2. **Custom business components (like FeatureCard, PricingCard) should USE shadcn/ui components internally**
3. **If a component requires props, they must be passed - check the component's interface**

## Common Patterns:

### Using Button (no required props)
```tsx
import { Button } from "@/components/ui/button"

<Button>Click me</Button>
<Button variant="outline">Outline</Button>
```

### Using Card (no required props, but use sub-components)
```tsx
import { Card, CardHeader, CardTitle, CardContent } from "@/components/ui/card"

<Card>
  <CardHeader>
    <CardTitle>Title</CardTitle>
  </CardHeader>
  <CardContent>Content</CardContent>
</Card>
```

### Creating Custom Components
```tsx
// ✅ CORRECT: Custom component uses shadcn/ui components
import { Card, CardHeader, CardTitle } from "@/components/ui/card"

interface MyCardProps {
  title: string
}

export function MyCard({ title }: MyCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
    </Card>
  )
}

// ❌ WRONG: Don't create custom Button/Card - they exist!
// export function Button() { ... } // Don't do this!
```

## If You See Property Errors:

- Check if the component has required props in its interface
- Look at ComponentExamples.tsx for reference
- Use the component as shown in examples
- Don't create new UI primitives - use existing ones from `@/components/ui/`

