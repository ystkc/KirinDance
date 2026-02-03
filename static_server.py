'''静态服务器入口程序'''
import http.server
import signal
import socketserver
import socket
import webbrowser
import threading
import os
import time

PORT = 8860
DIRECTORY = os.path.dirname(os.path.abspath(__file__))

def test_port(port):
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    try:
        s.connect(('127.0.0.1', port))
        s.shutdown(2)
        return True
    except:
        return False

def open_browser():
    '''测试端口，如果有响应，则打开浏览器'''
    while True:
        if test_port(PORT):
            break
    webbrowser.open(f'http://localhost:{PORT}')


if __name__ == '__main__':
    # 切换到网站目录
    os.chdir(DIRECTORY)
    
    # 启动浏览器
    threading.Thread(target=open_browser).start()
    
    # 启动服务器
    Handler = http.server.SimpleHTTPRequestHandler
    # with socketserver.TCPServer(("", PORT), Handler) as httpd:
    with http.server.ThreadingHTTPServer(("", PORT), Handler) as httpd:
        print(f"Serving at http://localhost:{PORT}")
        print(f"正在{PORT}端口上运行静态服务器")
        print("Close the browser and then press Ctrl+C ONCE within the window to stop the server.")
        print("关闭方式：先关闭浏览器，然后在本窗口内按【一次】Ctrl+C")
        
        def shutdown_func(signum, frame):
            print("Shutting down server...")
            httpd.shutdown()
            print("Server stopped.")

        def shutdown_func_wrapper(signum, frame):
            print("Received signal, shutting down server...")
            threading.Thread(target=shutdown_func, args=(signum, frame)).start()
            
        signal.signal(signal.SIGINT, shutdown_func_wrapper)
        httpd.serve_forever()
