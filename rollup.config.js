import resolve from '@rollup/plugin-node-resolve';
import commonjs from 'rollup-plugin-commonjs';

export default {
  input: './static/js/camera.js',
  output: {
    file: './static/bundle/bundle.js',
    format: 'iife',
    name: 'PoseEstimation'
  },
  plugins: [
    resolve(),
    commonjs()
  ]
};