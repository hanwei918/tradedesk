/* Flowing gradient background (the "Shader Gradient" look) in plain WebGL 1: no library, works offline.
   It renders at half resolution, about 30 fps, stops when the tab is hidden, and draws one still frame
   when the system asks for reduced motion. Without WebGL, or if the context is lost, the CSS aurora
   in style.css stays. */
(() => {
  const canvas = document.createElement("canvas");
  canvas.id = "flow-bg";
  canvas.setAttribute("aria-hidden", "true");
  let gl = null;
  try { gl = canvas.getContext("webgl", { antialias: false, alpha: false, depth: false, powerPreference: "low-power" }); } catch (e) { gl = null; }
  if (!gl) return;

  const VS = "attribute vec2 p;void main(){gl_Position=vec4(p,0.,1.);}";
  const FS = `precision mediump float;
uniform vec2 r;uniform float t;uniform float dark;
vec2 g(vec2 p){p=vec2(dot(p,vec2(127.1,311.7)),dot(p,vec2(269.5,183.3)));return -1.+2.*fract(sin(p)*43758.5453);}
float n(vec2 p){const float K1=.366025404,K2=.211324865;vec2 i=floor(p+(p.x+p.y)*K1);vec2 a=p-i+(i.x+i.y)*K2;
  float m=step(a.y,a.x);vec2 o=vec2(m,1.-m);vec2 b=a-o+K2;vec2 c=a-1.+2.*K2;
  vec3 h=max(.5-vec3(dot(a,a),dot(b,b),dot(c,c)),0.);vec3 q=h*h*h*h*vec3(dot(a,g(i)),dot(b,g(i+o)),dot(c,g(i+1.)));
  return dot(q,vec3(70.));}
void main(){
  vec2 uv=gl_FragCoord.xy/r;vec2 p=uv*vec2(r.x/r.y,1.)*1.3;float s=t*.03;
  vec2 q=vec2(n(p+vec2(0.,s)),n(p+vec2(5.2,1.3-s)));
  vec2 w=vec2(n(p+1.6*q+vec2(1.7,9.2)+s*.7),n(p+1.6*q+vec2(8.3,2.8)-s*.6));
  float f=smoothstep(-.4,.9,n(p+1.5*w));
  vec3 cyan=vec3(.282,.886,.859),blue=vec3(.455,.627,1.),violet=vec3(.718,.584,1.);
  vec3 tint=mix(mix(cyan,blue,smoothstep(-.6,.6,w.x)),violet,smoothstep(-.1,.9,w.y));
  vec3 navy=vec3(.027,.055,.145),paper=vec3(.957,.965,.984);
  vec3 col=dark>.5?navy+tint*(.03+.19*f):mix(paper,tint,.04+.16*f);
  gl_FragColor=vec4(col,1.);
}`;

  function shader(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
  }
  const vs = shader(gl.VERTEX_SHADER, VS), fs = shader(gl.FRAGMENT_SHADER, FS);
  if (!vs || !fs) return;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p");
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const uR = gl.getUniformLocation(prog, "r"), uT = gl.getUniformLocation(prog, "t"), uDark = gl.getUniformLocation(prog, "dark");

  const darkMq = matchMedia("(prefers-color-scheme: dark)"), still = matchMedia("(prefers-reduced-motion: reduce)");
  const isDark = () => { const t = document.documentElement.dataset.theme; return t ? t === "dark" : darkMq.matches; };
  let raf = 0, last = 0, lost = false;

  function size() {
    canvas.width = Math.max(1, Math.round(innerWidth / 2));
    canvas.height = Math.max(1, Math.round(innerHeight / 2));
    gl.viewport(0, 0, canvas.width, canvas.height);
  }
  function draw(sec) {
    if (lost) return;
    gl.uniform2f(uR, canvas.width, canvas.height);
    gl.uniform1f(uT, sec);
    gl.uniform1f(uDark, isDark() ? 1 : 0);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }
  function frame(now) {
    raf = requestAnimationFrame(frame);
    if (now - last < 33) return;
    last = now;
    draw(now / 1000);
  }
  function start() {
    cancelAnimationFrame(raf);
    if (still.matches) draw(40); else raf = requestAnimationFrame(frame);
  }

  canvas.addEventListener("webglcontextlost", (e) => {
    e.preventDefault(); lost = true; cancelAnimationFrame(raf);
    document.documentElement.classList.remove("flow-on"); canvas.remove();
  });
  addEventListener("resize", () => { size(); if (still.matches) draw(40); });
  document.addEventListener("visibilitychange", () => { if (document.hidden) cancelAnimationFrame(raf); else start(); });
  new MutationObserver(() => { if (still.matches) draw(40); }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  still.addEventListener?.("change", start);

  size();
  document.body.prepend(canvas);
  document.documentElement.classList.add("flow-on");
  start();
})();
