# CoinSecret interface conventions

## Product
CoinSecret provides market analysis and editorial news. News uses the existing application and backoffice frames.

## Color
Use the semantic Tailwind tokens from `src/app/globals.css`. Background, surface, border, foreground and muted establish hierarchy. Accent marks interactive controls. Positive, warning and negative communicate status.

## Typography
Use the existing Geist sans family. Page titles use bold tracking-tight type. Article text uses readable base size and generous line height. Muted text supports titles and primary actions.

## Layout
Keep public article reading width to `max-w-3xl`. Lists use responsive one, two and three column grids. Admin fields remain single column at small sizes and may pair at medium sizes.

## Components
Reuse AppShell, AdminShell and BrandLockup. Controls use existing rounded borders, semantic surfaces and accent buttons. Navigation uses Link. Icons come from Lucide.

## States and accessibility
Label every field. Show loading, empty, error and saving feedback. Keep keyboard focus visible through the global focus style. Mark active tabs and disabled actions. Preview uses the same content renderer as public articles.

## Motion
Use existing transition-colors for interactive feedback and respect the global reduced-motion rules.
