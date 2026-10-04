using System;
using System.Collections.Generic;
using System.Globalization;

namespace LSA.Enhanced.Input
{
    // Windows virtual-key names shared by LSA.Enhanced.json and Essential's
    // LosSantosAlive.config. Mouse4/Mouse5 are XBUTTON1/XBUTTON2.
    public static class PhysicalKeys
    {
        public const int XButton1 = 0x05, XButton2 = 0x06;
        static readonly Dictionary<string,int> ByName = new Dictionary<string,int>(StringComparer.OrdinalIgnoreCase);
        static readonly Dictionary<int,string> Names = new Dictionary<int,string>();
        // Never valid router keys: RPH console, Essential's F7 menu, Steam's
        // screenshot key, and keys GTA or menus need for basic navigation.
        static readonly HashSet<int> Reserved = new HashSet<int> {0x73,0x76,0x7B,0x1B,0x0D,0x09,0x20,0x01,0x02,0x04};
        static readonly HashSet<int> Extended = new HashSet<int> {0x21,0x22,0x23,0x24,0x25,0x26,0x27,0x28,0x2D,0x2E,0x6F,0x90};
        static PhysicalKeys()
        {
            for (int index = 1; index <= 24; index++) Add("F" + index,0x6F + index);
            for (char letter = 'A'; letter <= 'Z'; letter++) Add(letter.ToString(),letter);
            for (int digit = 0; digit <= 9; digit++) { Add("D" + digit,0x30 + digit); Alias(digit.ToString(CultureInfo.InvariantCulture),0x30 + digit); Add("NumPad" + digit,0x60 + digit); }
            Add("Mouse1",0x01); Add("Mouse2",0x02); Add("Mouse3",0x04); Add("Mouse4",XButton1); Add("Mouse5",XButton2);
            Alias("LButton",0x01); Alias("RButton",0x02); Alias("MButton",0x04); Alias("XButton1",XButton1); Alias("XButton2",XButton2);
            Add("Insert",0x2D); Add("Delete",0x2E); Add("Home",0x24); Add("End",0x23); Add("PageUp",0x21); Add("PageDown",0x22);
            Add("Up",0x26); Add("Down",0x28); Add("Left",0x25); Add("Right",0x27); Add("Pause",0x13); Add("ScrollLock",0x91); Add("CapsLock",0x14);
            Add("Escape",0x1B); Add("Enter",0x0D); Alias("Return",0x0D); Add("Tab",0x09); Add("Space",0x20); Add("Back",0x08);
            Add("Multiply",0x6A); Add("Add",0x6B); Add("Subtract",0x6D); Add("Decimal",0x6E); Add("Divide",0x6F);
            Add("LShiftKey",0xA0); Add("RShiftKey",0xA1); Add("LControlKey",0xA2); Add("RControlKey",0xA3); Add("LMenu",0xA4); Add("RMenu",0xA5);
        }
        static void Add(string name,int vk) { ByName[name] = vk; Names[vk] = name; }
        static void Alias(string name,int vk) => ByName[name] = vk;
        public static bool TryParse(string name,out int vk)
        {
            vk = 0;
            return name != null && name.Length <= 16 && ByName.TryGetValue(name.Trim(),out vk);
        }
        public static string Name(int vk) => Names.TryGetValue(vk,out var name) ? name : "VK" + vk.ToString("X2",CultureInfo.InvariantCulture);
        public static bool IsMouse(int vk) => vk == 0x01 || vk == 0x02 || vk == 0x04 || vk == XButton1 || vk == XButton2;
        // A router key is polled with GetAsyncKeyState and must never be a key
        // something else in the session depends on.
        public static bool UsableAsRouterKey(int vk) => vk > 0 && vk < 0xFF && !Reserved.Contains(vk);
        // Keyboard keys and the two X buttons can be synthesized with SendInput.
        public static bool Relayable(int vk) => vk == XButton1 || vk == XButton2 || vk > 0x07 && vk < 0xFF;
        public static bool IsExtended(int vk) => Extended.Contains(vk);
    }
}
