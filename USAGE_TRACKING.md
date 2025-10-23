# Usage Tracking & Limits

## 📊 What's Tracked

The platform tracks the following metrics for each user:

### 1. **Generations**
- **What**: Number of AI-powered website generations
- **Limit**: Based on pricing tier (Free: 3/month, Starter: 50/month, etc.)
- **Resets**: Monthly (on the 1st of each month)
- **Display**: Progress bar in user menu + badge on main page

### 2. **Projects**
- **What**: Total number of projects/websites created
- **Limit**: Based on pricing tier (Free: 3 total, Starter: 25 total, etc.)
- **Resets**: Never (lifetime limit)
- **Display**: Progress bar in user menu

### 3. **Tokens**
- **What**: Total OpenAI tokens consumed by generations
- **Limit**: Per-generation limit (Free: 4000 tokens, Starter: 8000 tokens, etc.)
- **Resets**: N/A (informational only)
- **Display**: Total count in user menu

---

## 🎯 Where Usage Is Displayed

### 1. **User Menu Dropdown** (Click avatar in top right)

Shows detailed usage stats:
```
┌─────────────────────────────────┐
│ Your Plan: Free Vibe            │
├─────────────────────────────────┤
│ Generations: 1 / 3              │
│ [████████░░░░░░░░░] 66%        │
│ 2 remaining this month          │
├─────────────────────────────────┤
│ Projects: 1 / 3                 │
│ [████████░░░░░░░░░] 33%        │
│ 2 slots available               │
├─────────────────────────────────┤
│ Tokens Used: 2,847              │
├─────────────────────────────────┤
│ [Upgrade for More] ← CTA button │
└─────────────────────────────────┘
```

**Features:**
- ✅ Real-time progress bars
- ✅ Color-coded based on usage (gradient fills)
- ✅ Shows exact counts (used / limit)
- ✅ Displays tier name with gradient badge
- ✅ Upgrade CTA when close to limits (80%+)
- ✅ Auto-refreshes every 30 seconds

### 2. **Usage Indicator Badge** (Top left corner)

Compact circular progress indicator:
```
┌──────────────────────────────┐
│  ⚡ Generations              │
│     2 / 3 left      ( 66% )  │
└──────────────────────────────┘
```

**Features:**
- ✅ Circular progress ring
- ✅ Color changes based on usage:
  - 🟢 Green: 0-79% used
  - 🟡 Yellow: 80-99% used
  - 🔴 Red: 100% used (with pulsing dot)
- ✅ Only shows when logged in
- ✅ Hides during generation
- ✅ Updates every 30 seconds

---

## 🔄 How Usage Updates

### Automatic Updates:
1. **After each generation** - API increments usage counters
2. **Every 30 seconds** - Frontend polls `/api/user/usage`
3. **On page load** - Fetches current usage
4. **After authentication** - Loads user's usage data

### Manual Refresh:
- Open/close user menu to force update
- Refresh the page

---

## 🚨 Limit Enforcement

### When Limits Are Reached:

#### **Generations Limit** (e.g., 3/3 used)
- ❌ "Generate" button returns 403 error
- 💬 Error message: "Monthly generation limit reached"
- 🎯 CTA: "Upgrade to continue"
- 📊 Shows upgrade button in user menu

#### **Projects Limit** (e.g., 3/3 projects)
- ❌ Cannot create new projects
- 💬 Error message: "Project limit reached"
- 🎯 CTA: "Upgrade for more projects"

#### **Token Limit** (per generation)
- ⚠️ AI response truncated at tier limit
- 💬 Still generates, but with fewer tokens
- 🎯 Upgrade for higher token limits

---

## 📈 Pricing Tier Limits

| Tier        | Generations/Month | Projects | Tokens/Gen | Price   |
|-------------|-------------------|----------|------------|---------|
| **Free**    | 3                 | 3        | 4,000      | $0      |
| **Starter** | 50                | 25       | 8,000      | $15/mo  |
| **Pro**     | 200               | 100      | 16,000     | $49/mo  |
| **Team**    | 1,000             | 500      | 32,000     | $149/mo |
| **Enterprise** | Unlimited      | Unlimited| 64,000     | $999/mo |

---

## 💻 Technical Implementation

### Frontend Hook: `useUserUsage()`

```typescript
import { useUserUsage } from '@/lib/hooks/useUserUsage'

function MyComponent() {
  const { usage, loading, refetch } = useUserUsage()
  
  if (loading) return <div>Loading...</div>
  
  return (
    <div>
      <p>Generations: {usage.generationsUsed} / {usage.generationsLimit}</p>
      <p>Tokens: {usage.tokensUsed}</p>
      <button onClick={refetch}>Refresh</button>
    </div>
  )
}
```

**Returns:**
- `usage` - Usage data object
- `loading` - Boolean loading state
- `refetch` - Function to manually refresh

### API Endpoint: `/api/user/usage`

**Method:** `GET`

**Auth:** Required (via Supabase session)

**Response:**
```json
{
  "generationsUsed": 2,
  "generationsLimit": 50,
  "generationsRemaining": 48,
  "tokensUsed": 5694,
  "projectsCreated": 5,
  "projectsLimit": 25,
  "projectsRemaining": 20,
  "tierName": "starter",
  "tierDisplayName": "Starter Plan",
  "periodStart": "2024-01-01T00:00:00Z",
  "periodEnd": "2024-02-01T00:00:00Z"
}
```

### Database Tables:

#### `user_usage`
- Tracks monthly usage per user
- Columns: `generations_count`, `tokens_used`, `period_start`, `period_end`
- Resets monthly via `period_start` check

#### `projects`
- Tracks all projects created
- Count determines project limit usage
- Never deleted (lifetime tracking)

#### `generations`
- Logs every generation attempt
- Columns: `tokens_used`, `success`, `cost_usd`
- Used for analytics and billing

---

## 🎨 UI Components

### 1. **UserMenu.tsx**
Full dropdown with detailed stats

**Location:** Top right corner  
**Trigger:** Click avatar  
**Content:** Usage bars, upgrade CTA, navigation

### 2. **UsageIndicator.tsx**
Compact badge with circular progress

**Location:** Top left corner  
**Always visible:** When logged in  
**Purpose:** At-a-glance usage check

### 3. **useUserUsage hook**
Shared state management

**Auto-refresh:** Every 30 seconds  
**Used by:** Both UI components  
**Caching:** Prevents duplicate API calls

---

## 🔮 Future Enhancements

### Planned Features:
- [ ] Usage history charts
- [ ] Email alerts at 80% usage
- [ ] Usage analytics dashboard
- [ ] Download usage reports (CSV)
- [ ] Overage billing for Enterprise
- [ ] Rollover unused generations
- [ ] Gift/transfer generations
- [ ] Usage forecasting

### Optimization Ideas:
- [ ] WebSocket for real-time updates
- [ ] Redis caching for usage data
- [ ] Batch usage updates
- [ ] Client-side usage prediction

---

## 🐛 Troubleshooting

### Issue: Usage not updating

**Symptoms:** Count stays the same after generation

**Fixes:**
1. Check browser console for API errors
2. Verify Supabase connection
3. Check `user_usage` table in Supabase
4. Manually call `refetch()` in component
5. Hard refresh page (Cmd+Shift+R)

### Issue: "Limit exceeded" but count shows available

**Symptoms:** 403 error but UI shows remaining generations

**Fixes:**
1. Check period dates in `user_usage` table
2. Verify tier limits in `pricing_tiers` table
3. Check for multiple usage records (should be 1 per month)
4. Re-run migration if needed

### Issue: Tokens showing 0

**Symptoms:** Token count always zero

**Fixes:**
1. Check `generations` table for `tokens_used` column
2. Verify OpenAI response includes `usage.total_tokens`
3. Check `/api/generate` saves token count
4. Manually update `user_usage.tokens_used` if needed

---

## 📚 Related Files

- `lib/hooks/useUserUsage.ts` - Frontend hook
- `app/api/user/usage/route.ts` - Usage API endpoint
- `app/components/UserMenu.tsx` - Dropdown component
- `app/components/UsageIndicator.tsx` - Badge component
- `lib/db.ts` - Database helper functions
- `PRICING_STRATEGY.md` - Pricing tier details

---

**TL;DR:**
- 📊 Track generations, projects, and tokens
- 🎯 Display in user menu + badge
- 🔄 Auto-refresh every 30 seconds
- 🚨 Enforce limits with clear CTAs
- 💰 Upgrade prompts at 80% usage

