import { useEffect, useRef } from "react";
import Reveal from "reveal.js";
import ReactKatex from "react-katex";
import type { PresentationDeck as Deck, SlideDiagram } from "../../data/presentations";
import "reveal.js/dist/reveal.css";
import "katex/dist/katex.min.css";
import "./presentation.css";

const { BlockMath } = ReactKatex;

function Diagram({ kind }: { kind: SlideDiagram }) {
  if (kind === "vectors") return <svg className="slide-diagram" viewBox="0 0 700 260" aria-label="Сложение противоположных векторов"><defs><marker id="slide-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" /></marker></defs><line className="accent" x1="350" y1="85" x2="610" y2="85" markerEnd="url(#slide-arrow)"/><line className="blue" x1="350" y1="170" x2="80" y2="170" markerEnd="url(#slide-arrow)"/><text x="455" y="60">+7 Н</text><text x="165" y="215">−3 Н</text></svg>;
  if (kind === "powers") return <div className="power-steps"><span>3 · 2</span><i>×</i><span>10⁴ · 10⁻²</span><i>=</i><strong>6 · 10²</strong></div>;
  if (kind === "si") return <svg className="slide-diagram" viewBox="0 0 700 250"><rect x="70" y="65" width="220" height="110"/><rect className="accent-fill" x="410" y="65" width="220" height="110"/><text x="125" y="130">см²</text><path className="blue" d="M300 120 H390"/><text x="448" y="130">м²</text><text x="268" y="92">× 10⁻⁴</text></svg>;
  if (kind === "particles") return <svg className="slide-diagram particles" viewBox="0 0 700 260">{[[90,70],[180,125],[285,65],[390,150],[510,75],[600,150],[235,205],[455,215]].map(([x,y],i)=><g key={i}><circle cx={x} cy={y} r="15"/><path d={`M${x-34} ${y+8} q17 -22 34 0 t34 0`}/></g>)}</svg>;
  if (kind === "heating") return <svg className="slide-diagram" viewBox="0 0 700 300"><line x1="75" y1="245" x2="650" y2="245"/><line x1="75" y1="245" x2="75" y2="35"/><polyline className="accent" points="85,225 270,125 465,125 625,45"/><text x="315" y="105">плавление</text><text x="635" y="275">t</text><text x="45" y="42">T</text></svg>;
  if (kind === "balance") return <svg className="slide-diagram" viewBox="0 0 700 270"><path className="blue" d="M350 55 V220 M160 220 H540 M205 220 L145 110 H265 Z M495 220 L435 110 H555 Z"/><circle className="accent-fill" cx="350" cy="55" r="17"/><text x="160" y="95">Q отдано</text><text x="450" y="95">Q получено</text></svg>;
  if (kind === "friction") return <svg className="slide-diagram" viewBox="0 0 700 270"><defs><marker id="friction-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" /></marker></defs><line x1="60" y1="220" x2="650" y2="220"/><rect x="270" y="125" width="170" height="95"/><line className="accent" x1="355" y1="95" x2="590" y2="95" markerEnd="url(#friction-arrow)"/><line className="blue" x1="355" y1="170" x2="120" y2="170" markerEnd="url(#friction-arrow)"/><text x="470" y="72">v</text><text x="135" y="150">Fтр</text></svg>;
  return <svg className="slide-diagram" viewBox="0 0 700 300"><defs><marker id="forces-arrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto"><path d="M0,0 L0,6 L9,3 z" /></marker></defs><line x1="65" y1="245" x2="640" y2="245"/><rect x="275" y="145" width="150" height="100"/><line className="blue" x1="350" y1="145" x2="350" y2="55" markerEnd="url(#forces-arrow)"/><line className="accent" x1="350" y1="245" x2="350" y2="295" markerEnd="url(#forces-arrow)"/><line className="blue" x1="275" y1="190" x2="120" y2="190" markerEnd="url(#forces-arrow)"/><line className="accent" x1="425" y1="175" x2="595" y2="110" markerEnd="url(#forces-arrow)"/><text x="370" y="65">N</text><text x="365" y="288">mg</text><text x="125" y="175">Fтр</text></svg>;
}

export default function PresentationDeck({ deck }: { deck: Deck }) {
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!revealRef.current) return;
    const reveal = new Reveal(revealRef.current, {
      embedded: true,
      hash: true,
      controls: true,
      progress: true,
      center: false,
      transition: "fade",
      backgroundTransition: "fade",
      width: 1440,
      height: 900,
      margin: 0.045,
    });
    reveal.initialize();
    return () => { reveal.destroy(); };
  }, []);

  return (
    <div className="reveal physics-reveal" ref={revealRef}>
      <div className="slides">
        {deck.slides.map((slide, index) => (
          <section key={`${deck.slug}-${index}`} data-auto-animate>
            <div className="slide-index">{String(index + 1).padStart(2, "0")} / {String(deck.slides.length).padStart(2, "0")}</div>
            {slide.kicker && <p className="slide-kicker">{slide.kicker}</p>}
            <h2>{slide.title}</h2>
            <div className={slide.diagram ? "slide-grid" : "slide-single"}>
              <div>
                {slide.body && <p className="slide-body">{slide.body}</p>}
                {slide.bullets && <ul>{slide.bullets.map((bullet) => <li className="fragment" key={bullet}>{bullet}</li>)}</ul>}
                {slide.formula && <div className="slide-formula"><BlockMath math={slide.formula} /></div>}
                {slide.answer && <div className="slide-answer fragment"><span>Ответ / вывод</span><strong>{slide.answer}</strong></div>}
              </div>
              {slide.diagram && <Diagram kind={slide.diagram} />}
            </div>
            {slide.teacherNote && <aside className="notes">{slide.teacherNote}</aside>}
          </section>
        ))}
      </div>
    </div>
  );
}
