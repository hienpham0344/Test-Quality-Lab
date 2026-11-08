// Dynamic interactive lab telemetry & ambient cybernetic grid shader
precision highp float;
uniform float u_time;
uniform vec2 u_resolution;
uniform vec2 u_mouse;

// Simplex-style noise helper
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x*34.0)+1.0)*x); }

float snoise(vec2 v) {
    const vec4 C = vec4(0.211324865405187,  // (3.0-sqrt(3.0))/6.0
                        0.366025403784439,  // 0.5*(sqrt(3.0)-1.0)
                       -0.577350269189626,  // -1.0 + 2.0 * C.x
                        0.024390243902439); // 1.0 / 41.0
    vec2 i  = floor(v + dot(v, C.yy) );
    vec2 x0 = v -   i + dot(i, C.xx);
    vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
    vec4 x12 = x0.xyxy + C.xxzz;
    x12.xy -= i1;
    i = mod289(i);
    vec3 p = permute( permute( i.y + vec3(0.0, i1.y, 1.0 ))
        + i.x + vec3(0.0, i1.x, 1.0 ));
    vec3 m = max(0.5 - vec3(dot(x0,x0), dot(x12.xy,x12.xy), dot(x12.zw,x12.zw)), 0.0);
    m = m*m ;
    m = m*m ;
    vec3 x = 2.0 * fract(p * C.www) - 1.0;
    vec3 h = abs(x) - 0.5;
    vec3 ox = floor(x + 0.5);
    vec3 a0 = x - ox;
    m *= 1.79284291400159 - 0.85373472095314 * ( a0*a0 + h*h );
    vec3 g;
    g.x  = a0.x  * x0.x  + h.x  * x0.y;
    g.yz = a0.yz * x12.xz + h.yz * x12.yw;
    return 130.0 * dot(m, g);
}

void main() {
    vec2 uv = gl_FragCoord.xy / u_resolution.xy;
    vec2 normMouse = u_mouse / u_resolution.xy;

    // Ambient background dark obsidian tones
    vec3 bgBase = vec3(0.043, 0.055, 0.082); // #0b0e15
    vec3 glowPrimary = vec3(0.24, 0.28, 0.95); // Indigo #3d47f3
    vec3 glowCyan = vec3(0.06, 0.72, 0.85); // Telemetry cyan #0fb8d9
    vec3 glowViolet = vec3(0.51, 0.22, 0.94); // Ambient purple

    // Subtle drifting mesh waves
    float t = u_time * 0.35;
    vec2 p = uv * 3.5;

    // Mouse proximity influence
    float mouseDist = distance(uv, normMouse);
    float mouseGlow = (1.0 - smoothstep(0.0, 0.45, mouseDist)) * 0.25;

    // Layered flowing currents
    float n1 = snoise(p + vec2(t * 0.4, t * 0.2));
    float n2 = snoise(p * 2.0 - vec2(t * 0.3, -t * 0.15));
    float combinedNoise = (n1 * 0.65 + n2 * 0.35);

    // Subtle luminous energy streaks across left telemetry section
    float beam = exp(-18.0 * abs(uv.y - 0.5 + 0.18 * sin(uv.x * 4.0 + t * 1.2) + combinedNoise * 0.1));

    // Radial atmospheric glow positioned behind the telemetry data and card
    vec2 centerLeft = vec2(0.28, 0.55);
    float radLeft = 1.0 - smoothstep(0.0, 0.8, distance(uv, centerLeft));

    vec2 centerRight = vec2(0.8, 0.5);
    float radRight = 1.0 - smoothstep(0.0, 0.7, distance(uv, centerRight));

    // Composite ambient colors
    vec3 col = bgBase;
    col += glowPrimary * (radLeft * 0.18 + combinedNoise * 0.06);
    col += glowCyan * (beam * 0.22 + mouseGlow * 0.6);
    col += glowViolet * (radRight * 0.12);

    // Subtle tech grid lines
    vec2 gridUv = fract(uv * vec2(36.0, 20.0));
    float grid = (step(0.97, gridUv.x) + step(0.97, gridUv.y)) * 0.025;
    col += vec3(0.3, 0.5, 0.8) * grid;

    gl_FragColor = vec4(col, 1.0);
}
