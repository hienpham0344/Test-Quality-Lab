import { useEffect, useRef } from 'react'
import fragmentSource from './login-background.glsl?raw'

function compile(gl, type, source) {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) return shader
  gl.deleteShader(shader)
  return null
}

export function LoginBackground() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const motion = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    if (!motion || motion.matches) return

    const gl = canvas.getContext('webgl', { alpha: false, antialias: false })
    if (!gl) return
    const vertex = compile(gl, gl.VERTEX_SHADER, 'attribute vec2 a_position; void main() { gl_Position = vec4(a_position, 0.0, 1.0); }')
    const fragment = compile(gl, gl.FRAGMENT_SHADER, fragmentSource)
    const program = gl.createProgram()
    const buffer = gl.createBuffer()

    function dispose() {
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }

    if (!vertex || !fragment || !program || !buffer) {
      dispose()
      return
    }
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      dispose()
      return
    }
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'a_position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    const resolution = gl.getUniformLocation(program, 'u_resolution')
    const time = gl.getUniformLocation(program, 'u_time')
    const mouse = gl.getUniformLocation(program, 'u_mouse')
    let pointerX = 0.5
    let pointerY = 0.5
    let frame = 0
    let lastDraw = -Infinity

    function resize() {
      const scale = Math.min(window.devicePixelRatio || 1, 1.25)
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * scale))
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * scale))
      gl.viewport(0, 0, canvas.width, canvas.height)
    }

    function movePointer(event) {
      const bounds = canvas.getBoundingClientRect()
      pointerX = (event.clientX - bounds.left) / bounds.width
      pointerY = 1 - (event.clientY - bounds.top) / bounds.height
    }

    function draw(timestamp) {
      if (motion.matches || gl.isContextLost()) {
        canvas.style.opacity = '0'
        return
      }
      if (timestamp - lastDraw >= 32) {
        gl.uniform1f(time, timestamp / 1000)
        gl.uniform2f(resolution, canvas.width, canvas.height)
        gl.uniform2f(mouse, pointerX * canvas.width, pointerY * canvas.height)
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
        canvas.style.opacity = '0.8'
        lastDraw = timestamp
      }
      frame = requestAnimationFrame(draw)
    }

    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(canvas)
    window.addEventListener('pointermove', movePointer, { passive: true })
    frame = requestAnimationFrame(draw)
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      window.removeEventListener('pointermove', movePointer)
      canvas.style.opacity = '0'
      dispose()
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden="true" className="pointer-events-none absolute inset-0 -z-10 h-full w-full opacity-0 motion-reduce:hidden" />
}
