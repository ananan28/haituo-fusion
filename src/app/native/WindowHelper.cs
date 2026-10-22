using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading;
public static class HaituoWindowFollower {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct POINT { public int X, Y; }
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr hWnd, out RECT rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr hWnd, ref POINT point);
  [DllImport("user32.dll")] static extern bool IsWindow(IntPtr hWnd);
  [DllImport("user32.dll", EntryPoint="SetWindowLongPtrW")] static extern IntPtr SetWindowLongPtr(IntPtr hWnd, int index, IntPtr value);
  [DllImport("user32.dll")] static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
  [DllImport("dwmapi.dll")] static extern int DwmFlush();
  [DllImport("winmm.dll")] static extern uint timeBeginPeriod(uint uPeriod);
  public static void Run(long childValue, long parentValue, int left, int top, int right, int bottom) {
    var child = new IntPtr(childValue); var parent = new IntPtr(parentValue);
    const uint positionFlags = 0x0010u | 0x0004u | 0x0100u;
    try { timeBeginPeriod(1); } catch {}
    try { Process.GetCurrentProcess().PriorityClass = ProcessPriorityClass.High; Thread.CurrentThread.Priority = ThreadPriority.Highest; } catch {}
    SetWindowLongPtr(child, -8, parent);
    while (IsWindow(child) && IsWindow(parent)) {
      RECT clientRect, childRect; POINT origin = new POINT();
      if (GetClientRect(parent, out clientRect) && ClientToScreen(parent, ref origin) && GetWindowRect(child, out childRect)) {
        int clientWidth = clientRect.Right - clientRect.Left, clientHeight = clientRect.Bottom - clientRect.Top;
        int x = origin.X + left, y = origin.Y + top;
        int width = Math.Max(1, clientWidth - left - right), height = Math.Max(1, clientHeight - top - bottom);
        if (childRect.Left != x || childRect.Top != y || childRect.Right - childRect.Left != width || childRect.Bottom - childRect.Top != height) {
          SetWindowPos(child, IntPtr.Zero, x, y, width, height, positionFlags);
          DwmFlush();
        }
      }
      Thread.Sleep(1);
    }
  }

  public static int Main(string[] args) {
    try {
      if(args.Length == 1 && args[0] == "--self-test") return IntPtr.Size == 8 ? 0 : 2;
      if(args.Length == 3 && args[0] == "owner") {
        SetWindowLongPtr(new IntPtr(long.Parse(args[1])), -8, new IntPtr(long.Parse(args[2]))); return 0;
      }
      if(args.Length != 7 || args[0] != "follow") return 2;
      Run(long.Parse(args[1]),long.Parse(args[2]),int.Parse(args[3]),int.Parse(args[4]),int.Parse(args[5]),int.Parse(args[6])); return 0;
    } catch { return 1; }
  }
}
