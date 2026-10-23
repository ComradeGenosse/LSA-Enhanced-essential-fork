"""Read-only file-handle inspection for the exact owned GTA PID; no injection."""
import ctypes as C,json,sys
from ctypes import wintypes as W
from pathlib import Path
class Entry(C.Structure):
 _fields_=[('obj',C.c_void_p),('pid',C.c_size_t),('handle',C.c_size_t),('access',W.ULONG),('trace',W.USHORT),('type',W.USHORT),('attrs',W.ULONG),('reserved',W.ULONG)]
n=C.WinDLL('ntdll'); k=C.WinDLL('kernel32',use_last_error=True)
k.OpenProcess.argtypes=[W.DWORD,W.BOOL,W.DWORD];k.OpenProcess.restype=W.HANDLE
k.GetCurrentProcess.restype=W.HANDLE
k.DuplicateHandle.argtypes=[W.HANDLE,W.HANDLE,W.HANDLE,C.POINTER(W.HANDLE),W.DWORD,W.BOOL,W.DWORD]
k.GetFileType.argtypes=[W.HANDLE];k.GetFileType.restype=W.DWORD
k.GetFinalPathNameByHandleW.argtypes=[W.HANDLE,W.LPWSTR,W.DWORD,W.DWORD]
k.CloseHandle.argtypes=[W.HANDLE]
size=1<<20
while True:
 b=C.create_string_buffer(size); required=W.ULONG();status=n.NtQuerySystemInformation(64,b,size,C.byref(required))
 if status==0:break
 if status & 0xffffffff != 0xc0000004:raise OSError(hex(status & 0xffffffff))
 size=max(size*2,required.value+65536)
pid=int(sys.argv[1]);process=k.OpenProcess(0x40,False,pid)
if not process:raise C.WinError(C.get_last_error())
count=C.c_size_t.from_buffer(b).value; paths=[]; inspected=0
for i in range(count):
 e=Entry.from_buffer(b,2*C.sizeof(C.c_size_t)+i*C.sizeof(Entry))
 if e.pid!=pid:continue
 h=W.HANDLE()
 if not k.DuplicateHandle(process,W.HANDLE(e.handle),k.GetCurrentProcess(),C.byref(h),0,False,2):continue
 try:
  if k.GetFileType(h)!=1:continue
  buf=C.create_unicode_buffer(4096)
  if k.GetFinalPathNameByHandleW(h,buf,4096,0):
   inspected+=1;p=buf.value
   if '.rpf' in p.lower() or '\\onigiri\\' in p.lower():paths.append(p)
 finally:k.CloseHandle(h)
k.CloseHandle(process)
result={'pid':pid,'diskFileHandles':inspected,'archivePaths':sorted(set(paths))}
Path(sys.argv[2]).write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
