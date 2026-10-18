using System;
using System.IO;

namespace LSA.Standalone.RageHost
{
    // Only report CLR member/type/assembly identifiers for known binding failures.
    // Exception.Message is otherwise untrusted: it may contain local paths,
    // configuration values, credentials, or unrelated user content.
    internal static class BindingFailureDiagnostics
    {
        internal static string Summary(Exception error)
        {
            if (error == null) return "kind=Unknown";
            string result = "kind=" + error.GetType().Name;
            string identifier;

            if (error is MissingMethodException &&
                TryMemberIdentifier(error.Message, "Method not found:", true, out identifier))
                return result + " member=" + identifier;

            if (error is MissingFieldException &&
                TryMemberIdentifier(error.Message, "Field not found:", false, out identifier))
                return result + " member=" + identifier;

            var type = error as TypeLoadException;
            if (type != null && SafeIdentifier(type.TypeName, 200, true))
                return result + " type=" + type.TypeName;

            var file = error as FileNotFoundException;
            if (file != null && TryAssemblyIdentifier(file.FileName, out identifier))
                return result + " assembly=" + identifier;

            var image = error as BadImageFormatException;
            if (image != null && TryAssemblyIdentifier(image.FileName, out identifier))
                return result + " assembly=" + identifier;

            // All other failures keep the established non-sensitive kind-only log.
            return result;
        }

        private static bool TryMemberIdentifier(string message, string prefix,
            bool method, out string identifier)
        {
            identifier = null;
            if (message == null || message.Length > 4096 ||
                !message.StartsWith(prefix, StringComparison.Ordinal))
                return false;
            int start = message.IndexOf('\'', prefix.Length);
            if (start < 0) return false;
            int end = message.IndexOf('\'', start + 1);
            if (end <= start + 1) return false;
            string candidate = message.Substring(start + 1, end - start - 1);
            if (!SafeIdentifier(candidate, 240, true) ||
                candidate.IndexOf('.') < 0 || (method && candidate.IndexOf('(') < 0))
                return false;
            identifier = candidate;
            return true;
        }

        private static bool TryAssemblyIdentifier(string fileName, out string identifier)
        {
            identifier = null;
            if (string.IsNullOrEmpty(fileName) || fileName.Length > 512) return false;
            // Assembly display names may contain Version/Culture/PublicKeyToken.
            // Only the simple assembly name is safe and relevant.
            string name = fileName.Split(',')[0].Trim();
            if (name.Length == 0 || name.Length > 128 ||
                name.StartsWith(".", StringComparison.Ordinal) ||
                name.Contains("..")) return false;
            foreach (char c in name)
                if (!AsciiLetterOrDigit(c) && c != '.' && c != '_' && c != '-')
                    return false;
            identifier = name;
            return true;
        }

        private static bool SafeIdentifier(string value, int limit, bool clrSyntax)
        {
            if (string.IsNullOrEmpty(value) || value.Length > limit) return false;
            foreach (char c in value)
            {
                if (AsciiLetterOrDigit(c) || c == '.' || c == '_') continue;
                if (clrSyntax && (c == ' ' || c == '+' || c == '-' || c == ':' ||
                    c == '(' || c == ')' || c == '[' || c == ']' ||
                    c == ',' || c == '!' || c == '<' || c == '>' ||
                    c == '&' || c == '*' || c == '`')) continue;
                return false;
            }
            return true;
        }

        private static bool AsciiLetterOrDigit(char c)
        {
            return (c >= 'A' && c <= 'Z') || (c >= 'a' && c <= 'z') ||
                (c >= '0' && c <= '9');
        }
    }
}
