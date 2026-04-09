emcc cpp/drawing.cpp -o src/drawing.js \
  -O3 \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME="ToolingModule" \
  -s EXPORTED_FUNCTIONS="['_process_stroke','_get_line_count','_get_lines_buffer','_clear_scene']" \
  -s EXPORTED_RUNTIME_METHODS="['ccall','cwrap']"