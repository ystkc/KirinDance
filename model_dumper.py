
# 注意，本程序依赖项mitmproxy不在该project内，需要自行安装
'''【独立工具】浏览器缓存器，选择性缓存某个地址的所有资源，其余正常放行'''
import winreg
import os
# 设置为当前路径
os.chdir(os.path.dirname(os.path.abspath(__file__)))
import mitmproxy.http
# 作用：拦截target_url的请求，直接发送本地路径下local_path的同名文件
target_url = "https://storage.googleapis.com"
local_path = "./static/bin_unzipped/"
from mitmproxy import http
import re
import os


class LocalFileInterceptor:
    def filename_processor(self, filename):
        '''去除文件名中的非法字符，并截取前50个字符'''
        illegal_chars = r'[\\/:*?"<>|\r\n]+'
        # 将非法字符替换为"-"
        sanitized_filename = re.sub(illegal_chars, '-', filename)
        return sanitized_filename
    
    def __init__(self, target_url, local_path):
        self.target_url = target_url
        self.local_path = local_path.rstrip('/')  # 移除路径末尾的斜

    def request(self, flow: http.HTTPFlow) -> None:
        # 匹配目标URL（支持模糊匹配）
        if self.target_url in flow.request.pretty_url:
            # 从URL中提取文件名
            filename = self.filename_processor(flow.request.path.split('?')[0])
            local_file = os.path.join(self.local_path, filename)
            
            try:
                # 读取本地文件内容(是包含请求头的完整响应)
                with open(local_file, 'rb') as f:
                    content = f.read()
                
                # 构造响应（状态码200，内容类型自动判断）
                flow.response = http.Response.make(
                    200,
                    content,
                    {"Content-Type": "application/octet-stream"}
                )
                print(f"Serving local file: {local_file}")
                
                # 尝试自动设置Content-Type（示例逻辑）
                if filename.endswith(".html"):
                    flow.response.headers["Content-Type"] = "text/html"
                elif filename.endswith(".json"):
                    flow.response.headers["Content-Type"] = "application/json"
                # 设置CORS（示例逻辑）
                flow.response.headers["Access-Control-Allow-Origin"] = "*"
                flow.response.headers["Incepted-rua"] = "rua" # 自定义响应头，标记已经被本地文件拦截
                # 可继续扩展其他文件类型...
                
            except FileNotFoundError:
                print(f"Local file not found: {local_file}")
            except Exception as e:
                print(f"Error: {str(e)}")
                flow.response = http.Response.make(
                    500,
                    f"Error: {str(e)}".encode(),
                    {"Content-Type": "text/plain"}
                )

    def response(self, flow: http.HTTPFlow) -> None:
        if "Incepted-rua" not in flow.response.headers and self.target_url in flow.request.pretty_url:
            print("Target URL matched, but not intercepted, saving response to local file...")
            filename = self.filename_processor(flow.request.path.split('?')[0])
            local_file = os.path.join(self.local_path, filename)
            with open(local_file, 'wb') as f:
                f.write(flow.response.content)
            print(f"Saved response to local file: {local_file}")


addons = [
    LocalFileInterceptor(target_url, local_path)
]


def set_proxy(enable=True, proxy_server="http://127.0.0.1:8080"):
    if enable:
        print("Setting proxy to:", proxy_server)
    else:
        print("Disabling proxy...")
    internet_settings = winreg.OpenKey(winreg.HKEY_CURRENT_USER,
                                       r'Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings',
                                       0, winreg.KEY_ALL_ACCESS)
    if enable:
        winreg.SetValueEx(internet_settings, "ProxyEnable", 0, winreg.REG_DWORD, 1)
        winreg.SetValueEx(internet_settings, "ProxyServer", 0, winreg.REG_SZ, proxy_server)
    else:
        winreg.SetValueEx(internet_settings, "ProxyEnable", 0, winreg.REG_DWORD, 0)
    winreg.CloseKey(internet_settings)

if __name__ == "__main__":
    try:
        set_proxy(True, "http://127.0.0.1:8080")
        os.system('mitmdump -q -s model_dumper.py --set tls_version_client_min=UNBOUNDED ')
    finally:
        set_proxy(False)