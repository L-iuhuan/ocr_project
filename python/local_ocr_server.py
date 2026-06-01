#!/usr/bin/env python3
"""Local OCR server for OCRFlow - wraps PaddleOCR-VL layout parsing."""

import argparse
import base64
import json
import os
import tempfile
from http.server import HTTPServer, BaseHTTPRequestHandler


class OCRHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/health":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps({"status": "ok", "provider": "paddleocr-local"}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def do_POST(self):
        if self.path == "/layout-parsing":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                payload = json.loads(body)

                file_data = payload.get("file", "")
                file_type = payload.get("fileType", 0)
                file_name = payload.get("file_name", "document.pdf")

                # Decode base64 to temp file
                suffix = ".pdf" if file_type == 0 else ".png"
                tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
                tmp.write(base64.b64decode(file_data))
                tmp.close()

                try:
                    result = self.run_ocr(tmp.name)
                finally:
                    os.unlink(tmp.name)

                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.end_headers()
                self.wfile.write(json.dumps({
                    "result": result,
                    "dataInfo": {"fileName": file_name}
                }, ensure_ascii=False).encode("utf-8"))

            except Exception as e:
                self.send_response(500)
                self.send_header("Content-Type", "application/json")
                self.end_headers()
                self.wfile.write(json.dumps({"error": str(e)}).encode())
        else:
            self.send_response(404)
            self.end_headers()

    def run_ocr(self, file_path: str) -> dict:
        """Run PaddleOCR-VL layout parsing. Falls back gracefully if not installed."""
        try:
            from paddleocr import PaddleOCR
            ocr = PaddleOCR(
                use_doc_orientation_classify=False,
                use_doc_unwarping=False,
                use_textline_orientation=False
            )
            results = ocr.predict(file_path)

            layout_results = []
            for res in results:
                res_data = res.json() if hasattr(res, 'json') else {}
                markdown_data = res.markdown() if hasattr(res, 'markdown') else ""
                layout_results.append({
                    "markdown": {"text": markdown_data if isinstance(markdown_data, str) else ""},
                    "prunedResult": res_data,
                    "outputImages": {}
                })

            return {"layoutParsingResults": layout_results}

        except ImportError:
            # PaddleOCR not installed - return a helpful error in the response
            return {
                "layoutParsingResults": [{
                    "markdown": {
                        "text": f"[PaddleOCR 未安装] 请运行: pip install paddleocr[all]\n\n文件: {os.path.basename(file_path)}\n\n安装后重启 OCRFlow 即可使用本地 OCR 功能。"
                    },
                    "prunedResult": {"error": "paddleocr_not_installed"},
                    "outputImages": {}
                }],
                "dataInfo": {"warning": "PaddleOCR not installed"}
            }

    def log_message(self, format, *args):
        print(f"[OCR Server] {args[0]}")


def main():
    parser = argparse.ArgumentParser(description="OCRFlow Local OCR Server")
    parser.add_argument("--port", type=int, default=8080, help="Server port")
    parser.add_argument("--pipeline", type=str, default="layout_parsing", help="Pipeline name")
    args = parser.parse_args()

    server = HTTPServer(("127.0.0.1", args.port), OCRHandler)
    print(f"[OCR Server] PaddleOCR local server starting on port {args.port}")
    print(f"[OCR Server] Pipeline: {args.pipeline}")
    print("Uvicorn running on http://127.0.0.1:{}".format(args.port))

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("[OCR Server] Shutting down...")
        server.shutdown()


if __name__ == "__main__":
    main()
