import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { GLOSSARY, splitTerms } from "./glossary";
import { Term, TermTip, defineTerms, termsIn, writtenId } from "./Term";
import { Stat } from "./ui";

describe("hover definitions (desk/usability item 11, §14.11)", () => {
  it("defines every term the brief names", () => {
    for (const printed of ["σ", "OAS", "2s10s", "RSI", "skew", "implied volatility", "realized vol", "beta", "R²", "bp", "basis points", "notional"])
      expect(termsIn(`a ${printed} b`), printed).toHaveLength(1);
  });

  it("Codex R-02: RSI is Wilder-smoothed with a 14-session period, not a 14-session window", () => {
    expect(GLOSSARY.rsi.text).toContain("Wilder-smoothed");
    expect(GLOSSARY.rsi.text).toContain("14-session period");
    expect(GLOSSARY.rsi.text).not.toMatch(/last 14 sessions/);
  });

  it("Codex R-04: outcomes count from each event's entry, as the engine sets it", () => {
    // src/desk/event_study.py entry_delay_vec: the first session whose target fixing is at or after every input is
    // known; a defer_as_target target (gold) enters the next session at the earliest. src/desk/series.py: the S&P is
    // fixed and known at the close, FRED known at the next open, the VIX at 16:15, gold and the dollar at 17:00, WTI
    // at 13:00 on the eighth business day.
    expect(GLOSSARY.entry.text).toBe("Entry is the session outcomes count from: the first whose target value is fixed no earlier than every input is known, and for a gold target the next at the earliest.");
    expect(GLOSSARY["entry-rule"].text).toBe("For an S&P target, a signal on S&P closes enters on its own session, one on FRED, VIX, dollar or gold data the next, and one on weekly WTI the eighth.");
    for (const id of ["col-es-n", "col-es-up", "col-es-median", "col-es-h5", "col-es-h10", "col-es-h20", "col-es-h60", "col-times", "col-up-month", "col-median"]) {
      expect(GLOSSARY[id].text, id).toMatch(/entry/);
      expect(GLOSSARY[id].text, id).not.toMatch(/sessions later|sessions after (those|each) (events|firing)\b/);
    }
  });

  it("Codex R-05: vs normal is the difference of median log returns times 100, or basis points for a yield or spread", () => {
    // api/desk_v2.py vs_normal: 100 × (median − baseline_median) for a log unit, the bp difference for bp.
    for (const id of ["vsnormal", "col-vs-normal"]) {
      expect(GLOSSARY[id].text, id).toMatch(/log returns?\b.*\btimes 100\b/);
      expect(GLOSSARY[id].text, id).toMatch(/basis points for a yield or spread/);
      expect(GLOSSARY[id].text, id).not.toMatch(/percentage points/);
    }
    expect(termsIn("+0.4 pts vs normal")).toEqual(["vsnormal"]);
    expect(termsIn("against a normal stretch")).toEqual(["baseline"]);
  });

  it("Codex R-06: current means within the series' allowed publication lag, and the lag rules are the freshness code's", () => {
    expect(GLOSSARY["col-pl-status"].text).toMatch(/within the series' allowed publication lag/);
    // api/freshness.py assess: the last completed session, or the one before until 06:00 UTC (2 AM EDT, 1 AM EST).
    expect(GLOSSARY["col-pl-lag-close"].text).toMatch(/last completed session's, or the one before until 2 AM ET \(1 AM in winter\)/);
    // DAILY_TOLERANCE = 3 on the bond calendar for rates and spreads; DESK_SLOW_PUBLICATION: WTI 8.
    expect(GLOSSARY["col-pl-lag-daily"].text).toMatch(/three business days .* bond calendar for rates and spreads; weekly WTI within eight/);
    // SERIES_REGISTRY: CPI's release day the 15th, unemployment the first Friday.
    expect(GLOSSARY["col-pl-lag-monthly"].text).toMatch(/the 15th for CPI and the first Friday for unemployment/);
  });

  it("each definition is one plain sentence", () => {
    for (const [id, t] of Object.entries(GLOSSARY)) {
      expect(t.text.endsWith("."), id).toBe(true);
      // One sentence: no full stop before the last one ends a sentence ("0.25" and "BBB−" are not stops).
      expect(t.text.slice(0, -1).match(/[.!?](\s|$)/), id).toBeNull();
      expect(t.text.split(/\s+/).length, id).toBeLessThanOrEqual(32);
    }
  });

  it("matches whole words, the longest form first, each term once per text", () => {
    expect(termsIn("DIVIDEND")).toEqual([]);
    expect(termsIn("IV rank")).toEqual(["implied"]);
    expect(termsIn("HY spread")).toEqual(["oas"]);
    expect(termsIn("HY spreads +2σ, 20 days")).toEqual(["hy", "sigma"]);
    expect(termsIn("2s10s +2σ steepening")).toEqual(["curve", "sigma", "steep"]);
    expect(termsIn("S&P 5-day move over 2σ, then 3σ")).toEqual(["sigma"]);
    expect(splitTerms("RSI (14)")).toEqual([{ text: "RSI", term: "rsi" }, { text: " (14)" }]);
  });

  it("wraps a printed label whole, so it keeps one text node", () => {
    render(<Stat label="RSI (14)" value="55" />);
    const el = screen.getByText("RSI (14)");
    expect(el.tagName).toBe("ABBR");
    expect(el).toHaveClass("dk-term");
    expect(el.getAttribute("data-def")).toBe(GLOSSARY.rsi.text);
    expect(el.getAttribute("aria-describedby")).toBe("dk-def-rsi");
    // A label without a term is printed as it is.
    expect(defineTerms("Last close")).toBe("Last close");
  });

  it("a scroll moves the tip with its term, and hides it once the term leaves the window", () => {
    render(
      <>
        <Stat label="2s10s" value="+52 bp" />
        <TermTip />
      </>,
    );
    const term = screen.getByText("2s10s").closest(".dk-term")!;
    let top = 100;
    term.getBoundingClientRect = () => ({ top, bottom: top + 15, left: 40, right: 120, width: 80, height: 15, x: 40, y: top, toJSON: () => ({}) }) as DOMRect;
    act(() => {
      fireEvent.pointerOver(term);
    });
    expect(screen.getByRole("tooltip")).toHaveStyle({ top: "121px" });
    // A scroll that lands after the pointer reached the term keeps the tip, moved with the term.
    top = 60;
    act(() => {
      fireEvent.scroll(window);
    });
    expect(screen.getByRole("tooltip")).toHaveStyle({ top: "81px" });
    top = -40;
    act(() => {
      fireEvent.scroll(window);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("shows the sentence on hover and on focus, and Escape hides it", () => {
    render(
      <>
        <Stat label="2s10s" value="+52 bp" />
        <TermTip />
      </>,
    );
    const term = screen.getByText("2s10s");
    // The hidden list the terms describe themselves by.
    expect(document.getElementById("dk-def-curve")?.textContent).toBe(GLOSSARY.curve.text);
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      fireEvent.pointerOver(term);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(GLOSSARY.curve.text);
    act(() => {
      fireEvent.keyDown(document, { key: "Escape" });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      fireEvent.focusIn(term);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(GLOSSARY.curve.text);
    act(() => {
      fireEvent.pointerOut(term, { relatedTarget: document.body });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });
});

describe("keyboard, touch and written definitions (desk/pdf-polish item 7)", () => {
  it("a term is a Tab stop of its own, but not inside a control, which takes the focus itself", () => {
    render(
      <>
        <Stat label="RSI (14)" value="55" />
        <button type="button">
          <Term ids={["beta"]}>Beta</Term>
        </button>
        <table>
          <tbody>
            <tr tabIndex={0}>
              <th>{defineTerms("2s10s +2σ steepening")}</th>
            </tr>
          </tbody>
        </table>
        <div role="region" aria-label="A table that scrolls" tabIndex={0}>
          <Term ids={["r2"]}>R²</Term>
        </div>
      </>,
    );
    expect(screen.getByText("RSI (14)")).toHaveAttribute("tabindex", "0");
    expect(screen.getByText("Beta")).not.toHaveAttribute("tabindex");
    expect(screen.getByText("2s10s +2σ steepening")).not.toHaveAttribute("tabindex");
    // A focusable scroll region is not a control: the column head keeps its stop.
    expect(screen.getByText("R²")).toHaveAttribute("tabindex", "0");
  });

  it("a tap shows the sentence until a tap elsewhere; the finger lifting does not hide it", () => {
    render(
      <>
        <Stat label="2s10s" value="+52 bp" />
        <p>elsewhere</p>
        <TermTip />
      </>,
    );
    // jsdom's pointer events carry no pointerType: a touch pointer's events are written out with it.
    const touch = (el: Element, type: string, init: MouseEventInit = {}) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true, ...init });
      Object.defineProperty(e, "pointerType", { value: "touch" });
      act(() => {
        el.dispatchEvent(e);
      });
    };
    const term = screen.getByText("2s10s");
    touch(term, "pointerover");
    touch(term, "pointerdown");
    expect(screen.getByRole("tooltip")).toHaveTextContent(GLOSSARY.curve.text);
    touch(term, "pointerout", { relatedTarget: document.body });
    expect(screen.getByRole("tooltip")).toHaveTextContent(GLOSSARY.curve.text);
    touch(screen.getByText("elsewhere"), "pointerdown");
    expect(screen.queryByRole("tooltip")).toBeNull();
    // A tap on the term alone (no pointerover first) shows it too.
    touch(term, "pointerdown");
    expect(screen.getByRole("tooltip")).toHaveTextContent(GLOSSARY.curve.text);
  });

  it("Codex R-10: a tap on a term inside a row shows its sentence and does not open the row; a mouse click still does", () => {
    const opened = vi.fn();
    const pressed = vi.fn();
    render(
      <>
        <table>
          <tbody>
            <tr tabIndex={0} onClick={opened}>
              <th>{defineTerms("2s10s +2σ steepening")}</th>
              <td>Sep 23</td>
            </tr>
          </tbody>
        </table>
        <button type="button" onClick={pressed}>
          <span>Gold call</span> <Term ids={["nav"]}>4% NAV</Term>
        </button>
        <TermTip />
      </>,
    );
    const pointer = (el: Element, type: string, pointerType: string) => {
      const e = new MouseEvent(type, { bubbles: true, cancelable: true });
      Object.defineProperty(e, "pointerType", { value: pointerType });
      act(() => {
        el.dispatchEvent(e);
      });
    };
    const tap = (el: Element) => {
      pointer(el, "pointerdown", "touch");
      act(() => {
        fireEvent.click(el);
      });
    };
    const title = screen.getByText("2s10s +2σ steepening");
    tap(title);
    expect(screen.getByRole("tooltip")).toHaveTextContent(GLOSSARY.curve.text);
    expect(opened).not.toHaveBeenCalled();
    // The rest of the row still opens it with a tap; a mouse click on the term does too (hover showed the sentence).
    tap(screen.getByText("Sep 23"));
    expect(opened).toHaveBeenCalledTimes(1);
    pointer(title, "pointerdown", "mouse");
    act(() => {
      fireEvent.click(title);
    });
    expect(opened).toHaveBeenCalledTimes(2);
    // A monitored position's button: a tap on its NAV shows the definition, and its focus keeps that sentence.
    const nav = screen.getByText("4% NAV");
    tap(nav);
    act(() => {
      fireEvent.focusIn(screen.getByRole("button"));
    });
    expect(pressed).not.toHaveBeenCalled();
    expect([...screen.getByRole("tooltip").querySelectorAll("p")].map((p) => p.textContent)).toEqual([GLOSSARY.nav.text]);
    tap(screen.getByText("Gold call"));
    expect(pressed).toHaveBeenCalledTimes(1);
  });

  it("a control that holds terms shows their sentences when it takes the focus; a pointer over the control alone shows none", () => {
    render(
      <>
        <button type="button">
          <Term ids={["nav"]}>4% NAV</Term> <Term ids={["col-room"]}>68% room</Term>
        </button>
        <TermTip />
      </>,
    );
    const button = screen.getByRole("button");
    act(() => {
      fireEvent.focusIn(button);
    });
    const tip = screen.getByRole("tooltip");
    expect([...tip.querySelectorAll("p")].map((p) => p.textContent)).toEqual([GLOSSARY.nav.text, GLOSSARY["col-room"].text]);
    act(() => {
      fireEvent.focusOut(button, { relatedTarget: document.body });
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      fireEvent.pointerOver(button);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("a definition written from data joins the hidden list while it shows, and the tip reads it", () => {
    const def = "The recession model reads data from three months earlier, so September's score uses June's readings.";
    const first = render(
      <>
        <Term def={def}>based on Jun 2026 data</Term>
        <TermTip />
      </>,
    );
    const term = screen.getByText("based on Jun 2026 data");
    expect(term).toHaveAttribute("data-term", "written");
    expect(term.getAttribute("aria-describedby")).toBe(writtenId(def));
    expect(document.getElementById(writtenId(def))?.textContent).toBe(def);
    act(() => {
      fireEvent.focusIn(term);
    });
    expect(screen.getByRole("tooltip")).toHaveTextContent(def);
    first.unmount();
    expect(document.getElementById(writtenId(def))).toBeNull();
    // A glossary term and a written sentence on one label: both, in that order.
    render(
      <>
        <Term ids={["beta"]} def="Over the last 252 daily returns.">
          Beta 1Y
        </Term>
        <TermTip />
      </>,
    );
    expect(screen.getByText("Beta 1Y").getAttribute("data-def")).toBe(`${GLOSSARY.beta.text}\nOver the last 252 daily returns.`);
  });
});
