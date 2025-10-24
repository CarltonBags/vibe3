# Apply New Pricing Tiers

## 🎯 Quick Start

### Step 1: Update Database

1. Go to **Supabase Dashboard** → **SQL Editor**
2. Open `supabase/migrations/002_update_pricing_tiers.sql`
3. **Copy all** the SQL
4. **Paste and Run** in Supabase

You should see:
```
✅ Pricing tiers updated successfully!
```

### Step 2: Verify Changes

Run this query in Supabase:
```sql
SELECT 
  display_name,
  price_monthly,
  max_generations_per_month,
  max_projects
FROM pricing_tiers
ORDER BY price_monthly;
```

Expected output:
| display_name | price_monthly | max_generations | max_projects |
|--------------|---------------|-----------------|--------------|
| Starter | $0 | 5 | 2 |
| Creator | $19 | 50 | 15 |
| Professional | $49 | 200 | 50 |
| Team | $99 | 500 | 999999 |
| Enterprise | $299 | 999999 | 999999 |

### Step 3: Refresh Your App

1. **Hard refresh** your browser (Cmd+Shift+R)
2. Check the **usage indicator** - should now show **"5 / 5"** for free tier
3. Try generating - limits are now enforced!

---

## 📊 New Tier Breakdown

### 🆓 **Starter (Free)** - $0/mo
**Value Prop:** "Try before you buy"

**Limits:**
- 5 generations/month
- 2 active projects
- 30-minute sandboxes
- 5,000 tokens/generation

**Perfect for:** Students, hobbyists, evaluating the platform

**Upgrade Trigger:** "5/5 used" → $0.50/extra gen or upgrade to Creator

---

### 💼 **Creator** - $19/mo ⭐ PRIMARY REVENUE DRIVER
**Value Prop:** "Build serious projects"

**Limits:**
- 50 generations/month
- 15 active projects
- 2-hour sandboxes
- 12,000 tokens/generation
- GitHub export ✅

**Perfect for:** Freelancers, solo devs, side projects

**Margin:** 47% ($9 profit per user)

**Upgrade Trigger:** "Need more complexity?" → Pro ($49)

---

### 🚀 **Professional** - $49/mo
**Value Prop:** "Ship production apps"

**Limits:**
- 200 generations/month
- 50 active projects
- 6-hour sandboxes
- 20,000 tokens/generation
- Custom domains (3) ✅
- Priority queue ✅

**Perfect for:** Full-time devs, agencies, startups

**Margin:** 20% ($10 profit per user)

**Upgrade Trigger:** "Adding team members?" → Team ($99)

---

### 👥 **Team** - $99/mo
**Value Prop:** "Collaborate & scale"

**Limits:**
- 500 generations/month
- Unlimited projects
- 24-hour sandboxes
- 32,000 tokens/generation
- 3 team seats ✅
- API access ✅

**Perfect for:** Development teams, agencies

**Margin:** 4% ($4 profit, but stable)

**Upgrade Trigger:** "Need white-label?" → Enterprise

---

### 🏢 **Enterprise** - $299+/mo
**Value Prop:** "Custom everything"

**Limits:**
- Unlimited (fair use)
- White-label ✅
- Private cluster ✅
- SSO/SAML ✅

**Perfect for:** Large companies, white-label partners

**Margin:** Negotiated (aim for 30-50%)

---

## 💰 Revenue Model

### Add-Ons (Extra Revenue):
- **Extra Generations:** $0.50/gen (any tier)
- **Extra Team Seats:** $20/seat/mo (Team+)
- **Extended Sandbox:** $5/day (any tier)

### Example User Journey:

**Month 1-2:** Free → Try 5 gens, loves it  
**Month 3:** Upgrades to Creator ($19/mo) → Needs GitHub  
**Month 6:** Upgrades to Pro ($49/mo) → Needs custom domain  
**Month 12:** Upgrades to Team ($99/mo) → Hires developer  

**Lifetime Value:** $0 + ($19×3) + ($49×6) + ($99×6) = **$945**

---

## 🎯 Conversion Tactics

### When User Hits Limit:

**Modal:**
```
┌─────────────────────────────────────┐
│  You've used all 5 generations!     │
│                                     │
│  Options:                           │
│  • Buy 1 extra generation - $0.50  │
│  • Upgrade to Creator - $19/mo     │
│    ✓ 50 generations                │
│    ✓ GitHub export                 │
│    ✓ 2-hour sandboxes              │
│                                     │
│  [Try 1 Generation] [Upgrade Now]  │
└─────────────────────────────────────┘
```

### Upgrade Indicators:

**In UI:**
- Free tier: "5/5 used 🔴" with pulsing indicator
- Creator tier: "45/50 used 🟡" at 90%
- Pro tier: "180/200 used 🟢"

---

## 📈 Success Metrics

### Track These:

1. **Conversion Rates:**
   - Free → Creator: Target 20%
   - Creator → Pro: Target 50%
   - Pro → Team: Target 40%

2. **Churn:**
   - Monthly churn < 5%
   - Annual churn < 30%

3. **ARPU (Average Revenue Per User):**
   - Month 6: $10
   - Month 12: $15
   - Month 24: $20

4. **CAC (Customer Acquisition Cost):**
   - Target: < $30
   - Payback: < 2 months

---

## 🚀 Next Steps

1. ✅ Run the SQL migration (above)
2. ⏳ Create `/pricing` page (coming next)
3. ⏳ Add Stripe integration
4. ⏳ Build upgrade modals
5. ⏳ Implement GitHub export
6. ⏳ Add custom domains

---

**Ready to apply?** Run the SQL migration now! 🎉

