// Framer Code Component: "This Week with Ryan" — live Mag Mile class schedule.
// Fetches the auto-scraped feed and renders the classes Ryan coaches this week.
import { useEffect, useState } from "react"
import { addPropertyControls, ControlType } from "framer"

const FEED =
    "https://raw.githubusercontent.com/rdobbeck/ryan-classes/main/docs/classes.json"

const DAY_ORDER = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const DAY_FULL: Record<string, string> = {
    Mon: "Monday", Tue: "Tuesday", Wed: "Wednesday", Thu: "Thursday",
    Fri: "Friday", Sat: "Saturday", Sun: "Sunday",
}

/**
 * @framerSupportedLayoutWidth any-prefer-fixed
 * @framerSupportedLayoutHeight auto
 */
export default function RyanClasses(props: any) {
    const {
        accent = "rgb(220, 38, 38)",
        phone = "(773) 491-7926",
        font = "Inter, sans-serif",
        cardBackground = "rgb(22, 22, 28)",
        textColor = "rgba(255, 255, 255, 0.92)",
        mutedColor = "rgba(255, 255, 255, 0.55)",
    } = props
    const [data, setData] = useState<any>(null)
    const [error, setError] = useState(false)

    useEffect(() => {
        fetch(FEED, { cache: "no-store" })
            .then((r) => r.json())
            .then(setData)
            .catch(() => setError(true))
    }, [])

    const week = data?.weeks?.[0]
    const gym = data?.gym
    const byDay: Record<string, any[]> = {}
    if (week) for (const c of week.classes) (byDay[c.day] ||= []).push(c)
    const days = DAY_ORDER.filter((d) => byDay[d]?.length)

    const wrap: React.CSSProperties = {
        fontFamily: font, width: "100%", boxSizing: "border-box",
        display: "flex", flexDirection: "column", gap: 18, color: textColor,
    }
    const card: React.CSSProperties = {
        border: "1px solid rgba(255,255,255,0.08)", borderRadius: 16, padding: "18px 20px",
        background: cardBackground,
    }

    return (
        <div style={wrap}>
            {error && (
                <div style={card}>
                    Couldn't load the schedule right now. Text {phone} and I'll tell you when I'm on.
                </div>
            )}

            {!error && !data && (
                <div style={{ ...card, color: mutedColor }}>Loading this week's classes…</div>
            )}

            {!error && data && days.length === 0 && (
                <div style={card}>
                    No classes posted for me this week yet. Text {phone} and I'll let you know my next sessions.
                </div>
            )}

            {days.map((d) => (
                <div key={d} style={card}>
                    <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 10 }}>
                        {DAY_FULL[d]}
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                        {byDay[d].map((c: any, i: number) => (
                            <div key={i} style={{
                                display: "flex", justifyContent: "space-between",
                                alignItems: "center", gap: 12,
                                padding: "8px 0", borderTop: i ? "1px solid rgba(255,255,255,0.08)" : "none",
                            }}>
                                <div>
                                    <div style={{ fontSize: 15, fontWeight: 600 }}>{c.title}</div>
                                    <div style={{ fontSize: 13, color: mutedColor }}>
                                        {c.start} – {c.end}
                                    </div>
                                </div>
                                <a href={c.bookUrl || gym?.scheduleUrl || "#"} target="_blank" rel="noreferrer"
                                    style={{
                                        fontSize: 13, fontWeight: 600, textDecoration: "none",
                                        color: "#fff", background: accent, padding: "8px 14px",
                                        borderRadius: 999, whiteSpace: "nowrap",
                                    }}>
                                    Book
                                </a>
                            </div>
                        ))}
                    </div>
                </div>
            ))}

            <div style={{ fontSize: 12, color: mutedColor }}>
                Schedule is set by the gym and updates automatically. Times vary week to week —
                text {phone} to confirm.
            </div>
        </div>
    )
}

addPropertyControls(RyanClasses, {
    accent: { type: ControlType.Color, title: "Accent", defaultValue: "rgb(220, 38, 38)" },
    cardBackground: { type: ControlType.Color, title: "Card BG", defaultValue: "rgb(22, 22, 28)" },
    textColor: { type: ControlType.Color, title: "Text", defaultValue: "rgba(255, 255, 255, 0.92)" },
    mutedColor: { type: ControlType.Color, title: "Muted", defaultValue: "rgba(255, 255, 255, 0.55)" },
    phone: { type: ControlType.String, title: "Phone", defaultValue: "(773) 491-7926" },
    font: { type: ControlType.String, title: "Font", defaultValue: "Inter, sans-serif" },
})
