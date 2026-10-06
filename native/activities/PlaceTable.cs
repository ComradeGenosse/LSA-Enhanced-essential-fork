using System.Collections.Generic;

namespace LSA.Activities
{
    public struct PlaceAnchor
    {
        public string PlaceRef, Kind, Label;
        public float X, Y, Z;
        public string IncarnationId;
    }

    // ACT2 resolves only "here": the actor position captured at admission.
    public sealed class PlaceTable
    {
        public const int Limit = 32;
        readonly Dictionary<string, PlaceAnchor> places = new Dictionary<string, PlaceAnchor>();
        public int Count => places.Count;
        public bool TryAdd(PlaceAnchor place)
        {
            if (place.PlaceRef == null || places.ContainsKey(place.PlaceRef)) return false;
            if (places.Count >= Limit) return false;
            if (place.Kind != "here") return false;
            places.Add(place.PlaceRef, place);
            return true;
        }
        public bool TryGet(string placeRef, out PlaceAnchor place) => places.TryGetValue(placeRef ?? "", out place);
        public void Retire(string incarnationId)
        {
            if (incarnationId == null) return;
            var gone = new List<string>();
            foreach (var pair in places) if (pair.Value.IncarnationId == incarnationId) gone.Add(pair.Key);
            foreach (var key in gone) places.Remove(key);
        }
        public void Clear() => places.Clear();
        public static string Band(float dx, float dy, float dz)
        {
            var distance = System.Math.Sqrt(dx * dx + dy * dy + dz * dz);
            return distance <= 3 ? "at" : distance <= 15 ? "near" : distance <= 50 ? "medium" : "far";
        }
    }
}
