using System;
using System.Collections.Generic;
using System.IO;
using System.Net;
using System.Text;
using System.Text.RegularExpressions;
using System.Threading;
using System.Web.Script.Serialization;
using LSA.Enhanced.Commands;

namespace LSA.Enhanced.Companion
{
    // Loopback client for the companion's character editor API (POST /api). The
    // token comes from the per-user endpoint file the companion writes, with the
    // editor page as a fallback for older companions and one retry after a 403
    // (the editor checks the token before doing any work). Never touches a ped.
    public sealed class CompanionClient : ICompanion
    {
        public const int ErrorBodyBytes = 4096;
        public static string EndpointPath = DefaultEndpointPath();
        static readonly Regex Code = new Regex("^[a-z][a-z0-9_]{0,63}$");
        readonly Func<string> origin;
        public CompanionClient(Func<string> origin) { this.origin = origin ?? throw new ArgumentNullException(nameof(origin)); }
        public void Post(string body,int maxBodyBytes,int timeoutMs,Action<CompanionReply> done)
        {
            string address = origin();
            ThreadPool.QueueUserWorkItem(_ => {
                CompanionReply reply;
                try { reply = Send(address,body,maxBodyBytes,null,timeoutMs); } catch { reply = new CompanionReply {Error = "companion_unavailable"}; }
                try { done?.Invoke(reply); } catch { }
            });
        }
        static string DefaultEndpointPath()
        {
            try { string root = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData); return string.IsNullOrEmpty(root) ? null : Path.Combine(root,"LSA Enhanced","control-endpoint.v1.json"); }
            catch { return null; }
        }
        // The endpoint file grants nothing beyond the page: any same-user process
        // can already GET / and read the token. It only replaces HTML scraping.
        public static string EndpointToken(string address)
        {
            try {
                string file = EndpointPath; if (file == null || address == null) return null;
                var info = new FileInfo(file); if (!info.Exists || info.Length > 4096) return null;
                var value = new JavaScriptSerializer {MaxJsonLength = 8192,RecursionLimit = 4}.DeserializeObject(File.ReadAllText(info.FullName)) as Dictionary<string,object>;
                if (value == null || !value.TryGetValue("version",out var version) || !(version is int number) || number != 1) return null;
                if (!value.TryGetValue("url",out var url) || !(url is string text) || text != address) return null;
                return value.TryGetValue("token",out var token) && token is string secret && Regex.IsMatch(secret,"^[a-f0-9]{64}$") ? secret : null;
            } catch { return null; }
        }
        static HttpWebRequest Request(string url)
        {
            var request = (HttpWebRequest)WebRequest.Create(url); request.Proxy = null; request.Timeout = 5000; request.ReadWriteTimeout = 5000; request.AllowAutoRedirect = false; return request;
        }
        static string Read(WebResponse response,int max)
        {
            using (var stream = response.GetResponseStream()) using (var output = new MemoryStream()) {
                var buffer = new byte[4096]; int bytes;
                while ((bytes = stream.Read(buffer,0,buffer.Length)) > 0) { if (output.Length + bytes > max) throw new InvalidDataException(); output.Write(buffer,0,bytes); }
                return Encoding.UTF8.GetString(output.ToArray());
            }
        }
        // Legacy handshake for companions that do not write the endpoint file yet.
        static string PageToken(string address)
        {
            string html; using (var page = Request(address).GetResponse()) html = Read(page,32768);
            var token = Regex.Match(html,"const auth=\"([a-f0-9]{64})\""); return token.Success ? token.Groups[1].Value : null;
        }
        static CompanionReply Post(string address,string token,string body,int maxBodyBytes,int timeoutMs)
        {
            var request = Request(address + "/api"); request.Method = "POST"; request.ContentType = "application/json"; request.Headers["Origin"] = address; request.Headers["x-lsa-editor"] = token;
            request.Timeout = request.ReadWriteTimeout = timeoutMs;
            var bytes = Encoding.UTF8.GetBytes(body); request.ContentLength = bytes.Length;
            using (var stream = request.GetRequestStream()) stream.Write(bytes,0,bytes.Length);
            // The editor completes the operation before its success status; callers
            // that only need the outcome never copy profile content. A success body
            // over the caller's limit still reports success, without the body.
            using (var response = (HttpWebResponse)request.GetResponse()) {
                string reply = null;
                if (maxBodyBytes > 0) try { reply = Read(response,maxBodyBytes); } catch (InvalidDataException) { reply = null; }
                return new CompanionReply {Ok = true,Status = (int)response.StatusCode,Body = reply};
            }
        }
        static int Status(WebException error) => error.Response is HttpWebResponse response ? (int)response.StatusCode : 0;
        static string ErrorCode(WebException error)
        {
            try {
                if (!(error.Response is HttpWebResponse response) || response.StatusCode != HttpStatusCode.BadRequest) return null;
                var value = new JavaScriptSerializer {MaxJsonLength = ErrorBodyBytes * 2}.DeserializeObject(Read(response,ErrorBodyBytes)) as Dictionary<string,object>;
                return value != null && value.TryGetValue("error",out var code) && code is string text && Code.IsMatch(text) ? text : null;
            } catch { return null; } finally { error.Response?.Close(); }
        }
        // Summons may wait for the game (summonWaitMs, up to 60 s), so the
        // caller picks the response timeout.
        public static CompanionReply Send(string address,string body,int maxBodyBytes,Func<bool> proceed = null,int timeoutMs = 5000)
        {
            string token = EndpointToken(address); bool fromFile = token != null;
            if (!fromFile) token = PageToken(address);
            if (token == null || proceed != null && !proceed()) return new CompanionReply {Error = "companion_unavailable"};
            try { return Post(address,token,body,maxBodyBytes,timeoutMs); }
            catch (WebException error) when (fromFile && Status(error) == 403) {
                error.Response?.Close();
                string page = PageToken(address);
                if (page == null) return new CompanionReply {Error = "companion_unavailable"};
                try { return Post(address,page,body,maxBodyBytes,timeoutMs); }
                catch (WebException retry) { return Failure(retry); }
            }
            catch (WebException error) { return Failure(error); }
        }
        static CompanionReply Failure(WebException error)
        {
            int status = Status(error); string code = ErrorCode(error);
            return new CompanionReply {Status = status,Error = code ?? "companion_unavailable"};
        }
    }
}
