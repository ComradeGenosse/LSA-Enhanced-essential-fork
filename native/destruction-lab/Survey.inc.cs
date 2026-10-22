    // Site selection only: no spawning, hiding, damage, or selector changes.
    void LabSurvey(Dictionary<string, string> a)
    {
        if (x7State != "None" || x8Registry.LeaseId != null)
            throw new Exception("survey_requires_no_native_lease");
        float x=F(a,"x",0), y=F(a,"y",0), z=F(a,"z",0);
        PrepareSite();
        Game.Player.Character.Position = new Vector3(x,y,z);
        WaitCollision(Game.Player.Character);
        for(int f=0;f<180;f++) Yield();
        foreach(float dx in new float[]{-20,-15,-10,10,15,20})
        foreach(float dy in new float[]{-10,-5,0,5,10})
        {
            Vector3 v=new Vector3(x+dx,y+dy,z);
            RaycastResult r=World.Raycast(v+Vector3.WorldUp*10f,v-Vector3.WorldUp*15f,(IntersectFlags)17,Game.Player.Character);
            Row("lab_survey_ground","x",v.X,"y",v.Y,"hit",r.DidHit,
                "z",r.HitPosition.Z,"nx",r.SurfaceNormal.X,"ny",r.SurfaceNormal.Y,"nz",r.SurfaceNormal.Z,
                "handle",r.HitEntity==null?0:r.HitEntity.Handle);
        }
        foreach(Prop p in World.GetNearbyProps(new Vector3(x,y,z),45f))
            if(p!=null && p.Exists()) Row("lab_survey_prop","hash",p.Model.Hash,
                "x",p.Position.X,"y",p.Position.Y,"z",p.Position.Z);
        Row("lab_survey_player","x",Game.Player.Character.Position.X,
            "y",Game.Player.Character.Position.Y,"z",Game.Player.Character.Position.Z);
    }
